export const STORYBOOK_BUILD_CONCURRENCY = 2
export const STORYBOOK_BUILD_CONCURRENCY_MAX = 8

type PendingBuild = {
  signal: AbortSignal
  resolve(release: () => void): void
  reject(error: unknown): void
  onAbort(): void
}

/** Shared bounded admission control; PackageSession still owns per-package order. */
export class StorybookBuildSemaphore {
  readonly #limit: number
  readonly #pending: PendingBuild[] = []
  #active = 0
  #disposed = false

  constructor(limit = STORYBOOK_BUILD_CONCURRENCY) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > STORYBOOK_BUILD_CONCURRENCY_MAX) {
      throw new Error(`Invalid Storybook build concurrency: ${String(limit)}`)
    }
    this.#limit = limit
  }

  get active(): number {
    return this.#active
  }

  get pending(): number {
    return this.#pending.length
  }

  async run<Value>(
    operation: () => Promise<Value>,
    signal: AbortSignal,
  ): Promise<Value> {
    if (typeof operation !== "function") throw new TypeError("Storybook build operation must be callable")
    const release = await this.acquire(signal)
    try {
      signal.throwIfAborted()
      return await operation()
    } finally {
      release()
    }
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (this.#disposed) return Promise.reject(new Error("Storybook build semaphore is disposed"))
    if (!(signal instanceof AbortSignal)) return Promise.reject(new TypeError("Storybook build signal is invalid"))
    if (signal.aborted) return Promise.reject(abortError(signal.reason))
    if (this.#active < this.#limit) return Promise.resolve(this.#admit())
    return new Promise<() => void>((resolvePromise, reject) => {
      const pending: PendingBuild = {
        signal,
        resolve: resolvePromise,
        reject,
        onAbort: () => {
          const index = this.#pending.indexOf(pending)
          if (index >= 0) this.#pending.splice(index, 1)
          reject(abortError(signal.reason))
        },
      }
      signal.addEventListener("abort", pending.onAbort, {once: true})
      this.#pending.push(pending)
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const pending of this.#pending.splice(0)) {
      pending.signal.removeEventListener("abort", pending.onAbort)
      pending.reject(new Error("Storybook build semaphore is disposed"))
    }
  }

  #admit(): () => void {
    this.#active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.#active = Math.max(0, this.#active - 1)
      this.#drain()
    }
  }

  #drain(): void {
    while (!this.#disposed && this.#active < this.#limit && this.#pending.length > 0) {
      const pending = this.#pending.shift()!
      pending.signal.removeEventListener("abort", pending.onAbort)
      if (pending.signal.aborted) {
        pending.reject(abortError(pending.signal.reason))
        continue
      }
      pending.resolve(this.#admit())
    }
  }
}

export function storybookAbortError(reason?: unknown): Error {
  return abortError(reason)
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new DOMException(reason === undefined ? "Storybook operation aborted" : String(reason), "AbortError")
}
