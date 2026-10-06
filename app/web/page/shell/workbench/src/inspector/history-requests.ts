/** Один бюджет HTTP-чтений для верхней истории и всех раскрытых групп беседы. */
export function createHistoryRequests(limit = 4) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Число чтений истории должно быть положительным целым")
  let active = 0
  const waiting: Array<() => void> = []
  return async function read<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    if (active >= limit) {
      if (waiting.length >= 128) throw new Error("Слишком много ожидающих чтений истории")
      await new Promise<void>((resolve, reject) => {
        const ready = () => {signal.removeEventListener("abort", aborted); resolve()}
        const aborted = () => {
          const index = waiting.indexOf(ready)
          if (index !== -1) waiting.splice(index, 1)
          reject(signal.reason)
        }
        signal.addEventListener("abort", aborted, {once: true})
        waiting.push(ready)
      })
    } else active++
    try {signal.throwIfAborted(); return await operation()}
    finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}
