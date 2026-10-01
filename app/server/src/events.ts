export type StorybookEventSubscription = Readonly<{
  close(): void
}>

/** Bounded in-process event hub used by the canonical server and long waits. */
export class StorybookEventHub<Event extends Readonly<{type: string}>> {
  readonly #listeners = new Set<(event: Event) => void>()
  readonly #recent: Event[] = []
  readonly #recentLimit: number
  #closed = false

  constructor(recentLimit = 128) {
    if (!Number.isSafeInteger(recentLimit) || recentLimit < 1 || recentLimit > 4_096) {
      throw new RangeError("Storybook event history limit must be between 1 and 4096")
    }
    this.#recentLimit = recentLimit
  }

  publish(event: Event): void {
    if (this.#closed) return
    this.#recent.push(event)
    if (this.#recent.length > this.#recentLimit) this.#recent.shift()
    for (const listener of [...this.#listeners]) listener(event)
  }

  subscribe(listener: (event: Event) => void): StorybookEventSubscription {
    if (this.#closed) throw new Error("Storybook event hub is closed")
    this.#listeners.add(listener)
    let closed = false
    return Object.freeze({
      close: () => {
        if (closed) return
        closed = true
        this.#listeners.delete(listener)
      },
    })
  }

  recent(predicate: (event: Event) => boolean): Event | null {
    for (let index = this.#recent.length - 1; index >= 0; index -= 1) {
      const event = this.#recent[index]!
      if (predicate(event)) return event
    }
    return null
  }

  wait(
    predicate: (event: Event) => boolean,
    options: Readonly<{timeoutMs: number; signal?: AbortSignal}>,
  ): Promise<Event | null> {
    if (this.#closed) throw new Error("Storybook event hub is closed")
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 120_000) {
      throw new RangeError("Storybook event timeout must be between 1 and 120000 ms")
    }
    const current = this.recent(predicate)
    if (current !== null) return Promise.resolve(current)
    return new Promise<Event | null>((resolvePromise, reject) => {
      let settled = false
      const subscription = this.subscribe((event) => {
        if (!predicate(event)) return
        finish(event)
      })
      const timer = setTimeout(() => finish(null), options.timeoutMs)
      const onAbort = (): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"))
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        subscription.close()
        options.signal?.removeEventListener("abort", onAbort)
      }
      const finish = (event: Event | null): void => {
        if (settled) return
        settled = true
        cleanup()
        resolvePromise(event)
      }
      options.signal?.addEventListener("abort", onAbort, {once: true})
      if (options.signal?.aborted === true) onAbort()
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#listeners.clear()
    this.#recent.length = 0
  }
}
