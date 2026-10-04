/**
Передаёт авторизованные запросы HTTP-сервису и читает
поток стадий, не владея временем жизни самой серверной операции.

@packageDocumentation
*/
import type {StorybookTechHttpClient} from "./contract"

export type {StorybookTechHttpClient} from "./contract"

/**
Привязывает запросы к одной приватной записи сервера.

Клиент удерживает переданную запись, не читает диск повторно и не владеет
процессом; вызывающий код создаёт новый экземпляр для нового daemon.
*/
export default class ExternalStorybookControlClient implements StorybookTechHttpClient.Output {
  readonly #record: StorybookTechHttpClient.Input

  /**
  Привязывает запросы к проверенной записи сервера.

  @param record - {@link StorybookTechHttpClient.Input} с операцией получения authorization; экземпляр
  использует тот же instance и origin весь свой срок жизни.
  */
  constructor(record: StorybookTechHttpClient.Input) {
    this.#record = record
  }

  /** Возвращает origin связанного instance без сетевого обращения. */
  get origin(): string {
    return this.#record.origin
  }

  /** Возвращает identity связанного instance без сетевого обращения. */
  get instanceId(): string {
    return this.#record.instanceId
  }

  /**
  Читает авторизованный JSON API.

  @param path - Абсолютный маршрут внутри `/api/` без собственного origin.
  @param signal - Необязательная отмена текущего ожидания.
  @returns Непрозрачный JSON-объект сервера.
  @throws При неверном пути, HTTP-ошибке, недопустимом JSON или отмене.
  */
  async read(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.#request(path, "GET", undefined, signal)
  }

  /**
  Отправляет авторизованную JSON-команду.

  @param path - Абсолютный маршрут внутри `/api/` без собственного origin.
  @param body - Данные команды, сериализуемые в JSON.
  @param signal - Необязательная отмена текущего ожидания.
  @returns Непрозрачный JSON-объект сервера.
  @throws При неверном пути, HTTP-ошибке, недопустимом JSON или отмене.
  */
  async control(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.#request(path, "POST", body, signal)
  }

  /**
  Читает стадии одной долгой операции и её итог из NDJSON без собственного срока ожидания.
  Отмена закрывает клиентский поток; принадлежащая серверу работа продолжается.
  Native socket idle timer выключен: предел операции определяет переданный signal,
  поэтому пауза компилятора между событиями не создаёт второй срок ожидания.
  JSON-ответ сохраняет совместимость с сервером без потоковой поддержки.

  @param path - Абсолютный маршрут внутри `/api/` без собственного origin.
  @param body - Данные команды, сериализуемые в JSON.
  @param onProgress - Необязательный обработчик каждого объекта progress; ожидается перед чтением следующего события.
  @param signal - Отменяет текущий поток ожидания, не отменяя серверную работу.
  @returns Объект result из NDJSON либо обычный JSON-объект ответа.
  @throws При неверном пути, HTTP-ошибке, недопустимом событии, завершении без результата или отмене.
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
      timeout: false,
      headers: {
        accept: "application/x-ndjson",
        authorization: this.#record.authorization(),
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
        authorization: this.#record.authorization(),
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
