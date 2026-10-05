/** Ограничивает опережение входящего stdio относительно durable обработки updates. */
export function notificationFlow() {
  let count = 0
  let bytes = 0
  let closed = false
  let wake: (() => void) | undefined
  const ready = () => closed || (count < 32 && bytes < 2 * 1024 * 1024)
  return {
    reserve(size: number): () => void {
      if (closed) throw new Error("ACP вход закрыт")
      // Один native chunk может содержать несколько коротких updates до остановки чтения.
      if (count >= 2048 || bytes + size > 32 * 1024 * 1024) throw new Error("ACP updates превысили ограниченный входной буфер")
      count += 1
      bytes += size
      let released = false
      return () => {
        if (released) return
        released = true
        count -= 1
        bytes -= size
        if (ready()) { const resume = wake; wake = undefined; resume?.() }
      }
    },
    async wait() {
      if (!ready()) await new Promise<void>(resolve => { wake = resolve })
    },
    close() { closed = true; wake?.(); wake = undefined },
    get pending() { return {count, bytes} },
  }
}

/** SDK декодирует NDJSON; получение следующей порции байтов ждёт освобождения окна. */
export function gatedInput(input: ReadableStream<Uint8Array>, wait: () => Promise<void>): ReadableStream<Uint8Array> {
  const reader = input.getReader()
  let cancelled = false
  return new ReadableStream({
    async pull(controller) {
      await wait()
      if (cancelled) return
      const next = await reader.read()
      if (cancelled) return
      if (next.done) { reader.releaseLock(); controller.close() }
      else controller.enqueue(next.value)
    },
    async cancel(reason) {
      cancelled = true
      try { await reader.cancel(reason) } finally { reader.releaseLock() }
    },
  }, {highWaterMark: 0})
}
