import type {ReadScenarioInput} from "@archetypes/specs/scenarios"

/**
Передаёт прогресс и единственный итог через NDJSON без накопления ответа до конца теста.
Закрытие соединения отменяет запрос и дочерний процесс. Живой вывод ограничен 256 Ки символов.
*/
export function streamScenarioRun(
  requestSignal: AbortSignal,
  execute: (signal: AbortSignal, onProgress: NonNullable<ReadScenarioInput["onProgress"]>) => Promise<unknown>,
): Response {
  const abort = new AbortController()
  const abortRequest = () => abort.abort(requestSignal.reason)
  requestSignal.addEventListener("abort", abortRequest, {once: true})
  if (requestSignal.aborted) abortRequest()
  const encoder = new TextEncoder()
  let closed = false
  let remaining = 256 * 1024
  let truncated = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (!closed && !abort.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
      }
      const progress: NonNullable<ReadScenarioInput["onProgress"]> = value => {
        if (value.text === undefined) {
          send({type: "progress", progress: value})
          return
        }
        if (remaining > 0) {
          const text = value.text.slice(0, remaining)
          remaining -= text.length
          send({type: "progress", progress: {...value, text}})
        }
        if (remaining === 0 && !truncated) {
          truncated = true
          send({type: "progress", progress: {phase: "running", text: "\nДальнейший вывод скрыт: достигнут предел журнала.\n"}})
        }
      }
      void Promise.resolve().then(() => execute(abort.signal, progress)).then(result => {
        send({type: "result", result})
      }).catch(error => {
        send({type: "error", error: error instanceof Error ? error.message : String(error)})
      }).finally(() => {
        requestSignal.removeEventListener("abort", abortRequest)
        if (!closed) {
          closed = true
          controller.close()
        }
      })
    },
    cancel(reason) {
      closed = true
      abort.abort(reason)
      requestSignal.removeEventListener("abort", abortRequest)
    },
  })
  return new Response(stream, {headers: {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  }})
}
