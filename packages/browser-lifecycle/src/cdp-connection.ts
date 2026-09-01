export type StorybookCdpWebSocket = Pick<WebSocket,
  "addEventListener" | "close" | "readyState" | "removeEventListener" | "send"
>

export type StorybookCdpWebSocketFactory = (url: string) => StorybookCdpWebSocket

type PendingCommand = Readonly<{
  resolve(value: Record<string, unknown>): void
  reject(error: unknown): void
  cleanup(): void
}>

export class StorybookCdpConnection {
  readonly #socket: StorybookCdpWebSocket
  readonly #pending = new Map<number, PendingCommand>()
  readonly #listeners = new Set<(message: Record<string, unknown>) => void>()
  #nextId = 1
  #closed = false

  private constructor(socket: StorybookCdpWebSocket) {
    this.#socket = socket
    socket.addEventListener("message", this.#onMessage as EventListener)
    socket.addEventListener("close", this.#onClose as EventListener)
    socket.addEventListener("error", this.#onError as EventListener)
  }

  static async connect(
    url: string,
    options: Readonly<{
      factory?: StorybookCdpWebSocketFactory
      signal?: AbortSignal | undefined
      timeoutMs?: number
    }> = {},
  ): Promise<StorybookCdpConnection> {
    const socket = (options.factory ?? ((value) => new WebSocket(value)))(exactWebSocketUrl(url))
    const timeoutMs = boundedTimeout(options.timeoutMs ?? 5_000)
    const signal = options.signal === undefined
      ? AbortSignal.timeout(timeoutMs)
      : AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
    await new Promise<void>((resolvePromise, reject) => {
      let settled = false
      const cleanup = (): void => {
        socket.removeEventListener("open", onOpen as EventListener)
        socket.removeEventListener("error", onError as EventListener)
        socket.removeEventListener("close", onClose as EventListener)
        signal.removeEventListener("abort", onAbort)
      }
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }
      const onOpen = (): void => finish(resolvePromise)
      const onError = (): void => finish(() => reject(new Error("Storybook CDP WebSocket connection failed")))
      const onClose = (): void => finish(() => reject(new Error("Storybook CDP WebSocket closed before opening")))
      const onAbort = (): void => finish(() => reject(signal.reason ?? new DOMException("Aborted", "AbortError")))
      socket.addEventListener("open", onOpen as EventListener, {once: true})
      socket.addEventListener("error", onError as EventListener, {once: true})
      socket.addEventListener("close", onClose as EventListener, {once: true})
      signal.addEventListener("abort", onAbort, {once: true})
      if (socket.readyState === WebSocket.OPEN) onOpen()
      else if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) onClose()
      else if (signal.aborted) onAbort()
    }).catch((error) => {
      socket.close()
      throw error
    })
    return new StorybookCdpConnection(socket)
  }

  onMessage(listener: (message: Record<string, unknown>) => void): () => void {
    this.#assertOpen()
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  command(
    method: string,
    params: Readonly<Record<string, unknown>> = Object.freeze({}),
    options: Readonly<{signal?: AbortSignal | undefined; timeoutMs?: number}> = {},
  ): Promise<Record<string, unknown>> {
    this.#assertOpen()
    const id = this.#nextId++
    const timeoutMs = boundedTimeout(options.timeoutMs ?? 30_000)
    const signal = options.signal === undefined
      ? AbortSignal.timeout(timeoutMs)
      : AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
    return new Promise<Record<string, unknown>>((resolvePromise, reject) => {
      let settled = false
      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort)
        this.#pending.delete(id)
      }
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }
      const onAbort = (): void => finish(() => reject(signal.reason ?? new DOMException("Aborted", "AbortError")))
      this.#pending.set(id, Object.freeze({
        resolve: (value) => finish(() => resolvePromise(value)),
        reject: (error) => finish(() => reject(error)),
        cleanup,
      }))
      signal.addEventListener("abort", onAbort, {once: true})
      if (signal.aborted) {
        onAbort()
        return
      }
      try {
        this.#socket.send(JSON.stringify({id, method: exactMethod(method), params}))
      } catch (error) {
        finish(() => reject(error))
      }
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#socket.removeEventListener("message", this.#onMessage as EventListener)
    this.#socket.removeEventListener("close", this.#onClose as EventListener)
    this.#socket.removeEventListener("error", this.#onError as EventListener)
    this.#rejectPending(new Error("Storybook CDP connection closed"))
    this.#listeners.clear()
    this.#socket.close()
  }

  readonly #onMessage = (event: MessageEvent): void => {
    void decodeMessage(event.data).then((value) => {
      if (value === null) return
      if (typeof value.id === "number") {
        const pending = this.#pending.get(value.id)
        if (pending === undefined) return
        if (value.error !== undefined) {
          const error = objectValue(value.error)
          pending.reject(new Error(`Storybook CDP command failed: ${String(error.message ?? "unknown error")}`))
        } else {
          pending.resolve(value.result === undefined ? Object.freeze({}) : objectValue(value.result))
        }
        return
      }
      for (const listener of [...this.#listeners]) listener(value)
    }).catch(() => {})
  }

  readonly #onClose = (): void => {
    if (this.#closed) return
    this.#closed = true
    this.#detach()
    this.#rejectPending(new Error("Storybook CDP connection closed unexpectedly"))
    this.#listeners.clear()
  }

  readonly #onError = (): void => {
    if (this.#closed) return
    this.#closed = true
    this.#detach()
    this.#rejectPending(new Error("Storybook CDP connection error"))
    this.#listeners.clear()
    this.#socket.close()
  }

  #detach(): void {
    this.#socket.removeEventListener("message", this.#onMessage as EventListener)
    this.#socket.removeEventListener("close", this.#onClose as EventListener)
    this.#socket.removeEventListener("error", this.#onError as EventListener)
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Storybook CDP connection is closed")
  }
}

async function decodeMessage(value: unknown): Promise<Record<string, unknown> | null> {
  let source: string
  if (typeof value === "string") source = value
  else if (value instanceof Blob) source = await value.text()
  else if (value instanceof ArrayBuffer) source = Buffer.from(value).toString("utf8")
  else if (ArrayBuffer.isView(value)) {
    source = Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8")
  } else return null
  const parsed = JSON.parse(source) as unknown
  return parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ? null
    : parsed as Record<string, unknown>
}

function exactWebSocketUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Storybook CDP endpoint is not WebSocket: ${value}`)
  }
  return url.href
}

function exactMethod(value: string): string {
  if (!/^[A-Z][A-Za-z0-9]+\.[A-Za-z][A-Za-z0-9]+$/u.test(value)) {
    throw new Error(`Invalid Storybook CDP method: ${value}`)
  }
  return value
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Storybook CDP value must be an object")
  }
  return value as Record<string, unknown>
}

function boundedTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 100 || value > 120_000) {
    throw new RangeError("Storybook CDP timeout must be between 100 and 120000 ms")
  }
  return value
}
