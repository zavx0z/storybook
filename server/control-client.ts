import {
  externalStorybookControlAuthorization,
} from "./security.ts"
import type {ExternalStorybookServerRecord} from "./server-state.ts"

export class ExternalStorybookControlClient {
  readonly #record: ExternalStorybookServerRecord

  constructor(record: ExternalStorybookServerRecord) {
    this.#record = record
  }

  get origin(): string {
    return this.#record.origin
  }

  get instanceId(): string {
    return this.#record.instanceId
  }

  async read(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.#request(path, "GET", undefined, signal)
  }

  async control(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.#request(path, "POST", body, signal)
  }

  /**
  Читает стадии одной долгой операции и её итог из NDJSON без собственного срока ожидания.
  Отмена закрывает клиентский поток; принадлежащая серверу работа продолжает свой lifecycle.
  JSON-ответ сохраняет совместимость с сервером без потоковой поддержки.
  */
  async controlStream(
    path: string,
    body: unknown,
    onProgress?: ((progress: Readonly<Record<string, unknown>>) => void | Promise<void>) | undefined,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!path.startsWith("/api/")) throw new Error(`Invalid Storybook API path: ${path}`)
    const response = await fetch(new URL(path, this.#record.origin), {
      method: "POST",
      redirect: "manual",
      headers: {
        accept: "application/x-ndjson",
        authorization: externalStorybookControlAuthorization(this.#record.controlToken),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : {signal}),
    })
    if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
      const value = await response.json().catch(() => null)
      if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : `Storybook control API failed with ${response.status}`)
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Storybook control API returned invalid JSON: ${path}`)
      }
      return value
    }
    if (response.body === null) throw new Error("Storybook control stream has no body")
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    /** Отсоединяет поток ожидания при отмене текущего клиента. */
    const abort = (): void => { void reader.cancel(signal?.reason).catch(() => {}) }
    signal?.addEventListener("abort", abort, {once: true})
    try {
      for (;;) {
        signal?.throwIfAborted()
        const chunk = await reader.read()
        signal?.throwIfAborted()
        buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, {stream: true})
        if (chunk.done && buffer !== "" && !buffer.endsWith("\n")) buffer += "\n"
        let newline: number
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (line === "") continue
          const event = JSON.parse(line)
          if (event?.type === "progress" && event.progress !== null && typeof event.progress === "object" && !Array.isArray(event.progress)) {
            await onProgress?.(event.progress)
          } else if (event?.type === "result" && event.result !== null && typeof event.result === "object" && !Array.isArray(event.result)) {
            return event.result
          } else if (event?.type === "error") {
            throw new Error(typeof event.error === "string" ? event.error : "Storybook control operation failed")
          } else {
            throw new Error("Storybook control stream returned an invalid event")
          }
        }
        if (chunk.done) throw new Error("Storybook control stream ended without a result")
      }
    } finally {
      signal?.removeEventListener("abort", abort)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }

  async #request(
    path: string,
    method: "GET" | "POST",
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!path.startsWith("/api/")) throw new Error(`Invalid Storybook API path: ${path}`)
    const timeout = AbortSignal.timeout(120_000)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const response = await fetch(new URL(path, this.#record.origin), {
      method,
      redirect: "manual",
      headers: {
        accept: "application/json",
        authorization: externalStorybookControlAuthorization(this.#record.controlToken),
        ...(method === "POST" ? {"content-type": "application/json"} : {}),
      },
      ...(method === "POST" ? {body: JSON.stringify(body)} : {}),
      signal: combined,
    })
    const value = await response.json().catch(() => null) as unknown
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Storybook control API returned invalid JSON: ${path}`)
    }
    const record = value as Record<string, unknown>
    if (!response.ok) {
      throw new Error(typeof record.error === "string"
        ? record.error
        : `Storybook control API failed with ${response.status}`)
    }
    return record
  }
}
