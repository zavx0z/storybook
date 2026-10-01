/**
Отдаёт заголовки страницы сразу, пока общая оболочка ожидает очередь сборки.

@param produce - Подготовка окончательного HTML с единственным обычным Workbench.

@param headers - Те же CSP и cache headers, что у готового документа.

@param signal - Отмена ожидания этим HTTP-клиентом; общая сборка принадлежит scheduler.

@param heartbeatMs - Интервал невидимых HTML-комментариев, поддерживающих transport.

@returns Поток одного документа. До готовности он не создаёт альтернативный UI
или второй Experience; отмена закрывает только поток и его таймер.
*/
export function preparingHtmlResponse(
  produce: () => Promise<string>,
  headers: HeadersInit,
  signal: AbortSignal,
  heartbeatMs = 10_000,
): Response {
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 10 || heartbeatMs > 60_000) throw new RangeError("HTML preparation heartbeat must be 10..60000ms")
  const encoder = new TextEncoder()
  const heartbeat = encoder.encode("<!-- Storybook: waiting for scheduled preparation -->\n")
  let cleanup = (): void => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let ended = false
      let timer: ReturnType<typeof setInterval> | undefined
      const close = (): void => {
        cleanup()
        try { controller.close() } catch {}
      }
      cleanup = (): void => {
        ended = true
        if (timer !== undefined) clearInterval(timer)
        signal.removeEventListener("abort", close)
      }
      signal.addEventListener("abort", close, {once: true})
      if (signal.aborted) { close(); return }
      const tick = (): void => {
        if (ended) return
        try { controller.enqueue(heartbeat) } catch { cleanup() }
      }
      tick()
      timer = setInterval(tick, heartbeatMs)
      timer.unref?.()
      const finish = (html: string): void => {
        if (ended) return
        cleanup()
        controller.enqueue(encoder.encode(html))
        controller.close()
      }
      void Promise.resolve().then(produce).then(finish, () => finish(
        '<!doctype html><html data-external-storybook-error="preparation failed"><head><title>Storybook</title></head><body><pre>Не удалось подготовить интерфейс. Подробности доступны в диагностике Storybook.</pre></body></html>',
      ))
    },
    cancel() { cleanup() },
  })
  return new Response(stream, {headers})
}
