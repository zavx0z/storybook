/**
Передаёт текущее состояние, живые стадии и итог управляющего вызова.
Закрытие клиентского потока освобождает наблюдение; общей сборкой владеет app.
*/
export function streamAppOperation(
  signal: AbortSignal,
  subscribe: (listener: (event: Readonly<Record<string, unknown>>) => void) => () => void,
  execute: () => Promise<Record<string, unknown>>,
): Response {
  const encoder = new TextEncoder()
  let closed = false
  let unsubscribe = () => {}
  let stop = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"))
      }
      stop = () => {
        if (closed) return
        closed = true
        unsubscribe()
        signal.removeEventListener("abort", stop)
        controller.close()
      }
      signal.addEventListener("abort", stop, {once: true})
      if (signal.aborted) { stop(); return }
      unsubscribe = subscribe(progress => send({type: "progress", progress}))
      void execute().then(result => send({type: "result", result})).catch(error => {
        send({type: "error", error: error instanceof Error ? error.message : String(error)})
      }).finally(stop)
    },
    cancel() {
      closed = true
      unsubscribe()
      signal.removeEventListener("abort", stop)
    },
  })
  return new Response(stream, {headers: {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  }})
}
