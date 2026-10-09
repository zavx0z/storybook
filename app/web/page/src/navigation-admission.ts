/** Отмена ожидания не останавливает полезную серверную работу и не разрешает поздний результат навигации. */
export function awaitNavigationWork<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const cancel = () => {signal.removeEventListener("abort", cancel); reject(signal.reason)}
    signal.addEventListener("abort", cancel, {once: true})
    void work.then(value => {
      signal.removeEventListener("abort", cancel)
      if (signal.aborted) reject(signal.reason)
      else resolve(value)
    }, error => {signal.removeEventListener("abort", cancel); reject(error)})
  })
}
