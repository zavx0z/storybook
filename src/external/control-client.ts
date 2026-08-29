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
