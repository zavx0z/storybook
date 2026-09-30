import type {BuildWorkerEvent} from "../contract/event"

/**
Дренирует JSONL pipe с выбранной политикой ограничения и обработки неверных строк.
strict ограничивает текущий буфер 65536 символами и требует завершённую строку.
tolerant принимает только chunks в пределах первых 65536 байтов. Пересечение
предела сбрасывает pending; остальной вывод всё равно дренируется. Хвост без
newline обрабатывается при EOF. Исключение parser остаётся транспортной ошибкой.
*/
export default async function readWorkerEvents<Progress>(
  stream: unknown,
  input: Readonly<{
    workerId: string
    pid: number
    mode: "strict" | "tolerant"
    parseEvent(value: unknown): BuildWorkerEvent<Progress> | null
    onReady(): void
    onProgress(event: Progress): void
  }>,
): Promise<string> {
  if (!(stream instanceof ReadableStream)) throw new Error("Build worker stdout is unavailable")
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  let consumed = 0
  let ready = false
  const strict = input.mode === "strict"
  const consumeLine = (line: string): void => {
    if (line.trim() === "") return
    if (!strict && line.length > 8 * 1024) return
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch (error) {
      if (strict) throw error
      return
    }
    const event = input.parseEvent(value)
    if (event?.kind === "phase" && ready) {
      input.onProgress(event.event)
      return
    }
    if (event?.kind === "ready" && !ready &&
      event.workerId === input.workerId && event.pid === input.pid) {
      ready = true
      input.onReady()
      return
    }
    if (strict) throw new Error("Build worker event does not match its owned process or stream order")
  }
  const consumeLines = (): void => {
    let end: number
    while ((end = pending.indexOf("\n")) !== -1) {
      consumeLine(pending.slice(0, end))
      pending = pending.slice(end + 1)
    }
  }
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (strict) {
        pending += decoder.decode(next.value, {stream: true})
        if (pending.length > 65_536) throw new Error("Build worker event buffer exceeds limit")
        consumeLines()
      } else if (consumed < 65_536) {
        consumed += next.value.byteLength
        if (consumed > 65_536) {
          pending = ""
          continue
        }
        pending += decoder.decode(next.value, {stream: true})
        consumeLines()
      }
    }
    pending += decoder.decode()
    if (strict && pending.trim() !== "") throw new Error("Build worker emitted an incomplete event")
    if (!strict && pending.length > 0) consumeLine(pending)
    return ""
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}
