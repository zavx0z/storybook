const disabled = "Storybook environment following was disabled before navigation"
const superseded = "Storybook environment following was superseded before navigation"

/** Page принимает только начало работы по адресу; выключение режима отменяет все ещё не принятые переходы. */
export function createEnvironmentFollow(options: Readonly<{
  enabled(): boolean
  subscribe(listener: () => void): () => void
  navigate(address: string, signal: AbortSignal): Promise<void>
  failed(error: unknown): void
  signal: AbortSignal
}>) {
  const seen = new Set<string>()
  let lastStartedAt = -1
  const pending = new Set<AbortController>()
  const work = new Set<Promise<unknown>>()
  const cancel = (message = disabled) => {
    for (const controller of pending) controller.abort(new DOMException(message, "AbortError"))
  }
  const stop = options.subscribe(() => {if (!options.enabled()) cancel()})
  options.signal.addEventListener("abort", () => {cancel(); stop()}, {once: true})
  const run = <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (!options.enabled()) return Promise.reject(new DOMException(disabled, "AbortError"))
    const controller = new AbortController()
    pending.add(controller)
    const signal = AbortSignal.any([options.signal, controller.signal])
    const result = (async () => {
      try {return await operation(signal)} catch (error) {
        if (signal.aborted) throw signal.reason
        throw error
      } finally {pending.delete(controller)}
    })()
    work.add(result)
    void result.then(() => work.delete(result), () => work.delete(result))
    return result
  }
  return Object.freeze({
    get pending() {return pending.size > 0},
    cancel,
    run,
    async whenSettled() {
      while (work.size > 0) await Promise.all([...work].map(value => value.catch(() => {})))
    },
    receive(value: unknown) {
      if (value === null || typeof value !== "object") return
      const event = value as Record<string, unknown>
      if (event.type !== "environment.activity" || typeof event.id !== "string" || !event.id || event.id.length > 256 ||
        typeof event.address !== "string" || !event.address.startsWith("/") || event.address.startsWith("//") || event.address.length > 2048 ||
        typeof event.startedAt !== "number" || !Number.isFinite(event.startedAt) || event.startedAt < 0 || seen.has(event.id)) return
      seen.add(event.id)
      if (seen.size > 128) seen.delete(seen.values().next().value!)
      if (event.startedAt < lastStartedAt) return
      lastStartedAt = event.startedAt
      if (!options.enabled() || options.signal.aborted) return
      cancel(superseded)
      void run(signal => options.navigate(event.address as string, signal)).catch(error => {
        if (!(error instanceof DOMException && error.name === "AbortError")) options.failed(error)
      })
    },
  })
}
