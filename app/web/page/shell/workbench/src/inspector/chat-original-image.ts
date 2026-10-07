import type {MediaPreview} from "@zavx0z/chat/content"

const MAX_ORIGINAL_BYTES = 16 * 1024 * 1024

/**
Оригинал открывается только по пользовательскому действию в отдельной native вкладке.
Синхронное резервирование сохраняет browser user activation; transport остаётся у host.
Raw Blob показан как img subresource, никогда как HTML/SVG document. URL создаёт
child realm: после handoff его lifetime принадлежит вкладке, а не чату.
*/
export async function openChatOriginalImage(document: Document, media: MediaPreview, signal: AbortSignal,
  load: (signal: AbortSignal) => Promise<Blob>): Promise<void> {
  signal.throwIfAborted()
  if (!media.mimeType.startsWith("image/")) throw new Error("В новой вкладке открываются только изображения")
  const tab = document.defaultView?.open("about:blank", "_blank")
  if (!tab) throw new Error("Браузер заблокировал новую вкладку. Разрешите открытие и повторите действие.")
  tab.opener = null
  const reserved = tab.document
  const initialUrl = reserved.URL
  const child = reserved.defaultView
  if (!child) {tab.close(); throw new Error("Новая вкладка недоступна")}
  const cancelled = new AbortController()
  const pendingSignal = AbortSignal.any([signal, cancelled.signal])
  let navigated = false
  let url: string | undefined
  let image: HTMLImageElement | undefined
  let stopImage = () => {}
  let stopLoadAbort = () => {}
  const stillOwned = (): boolean => {
    try {return !navigated && !tab.closed && tab.document === reserved && reserved.URL === initialUrl}
    catch {return false}
  }
  const pageHide = () => {
    // pagehide начинается до замены Document. Не закрываем пользовательскую
    // навигацию, даже если WindowProxy ещё показывает прежнюю blank страницу.
    navigated = true
    cancelled.abort(new DOMException("Открытие оригинала отменено", "AbortError"))
  }
  child.addEventListener("pagehide", pageHide, {once: true})
  try {
    // Отмена lifecycle не ждёт transport, который мог игнорировать signal.
    // Race наблюдает и поздний reject loader, не оставляя unhandled rejection.
    const aborted = new Promise<never>((_resolve, reject) => {
      const abort = () => reject(pendingSignal.reason)
      stopLoadAbort = () => pendingSignal.removeEventListener("abort", abort)
      pendingSignal.addEventListener("abort", abort, {once: true})
      if (pendingSignal.aborted) abort()
    })
    const blob = await Promise.race([aborted, (async () => {
      pendingSignal.throwIfAborted()
      return load(pendingSignal)
    })()])
    stopLoadAbort()
    pendingSignal.throwIfAborted()
    if (!stillOwned()) throw new DOMException("Новая вкладка уже перешла к другому документу", "AbortError")
    if (blob.size > MAX_ORIGINAL_BYTES) throw new Error("Оригинал изображения ограничен 16 МиБ")
    const mimeType = blob.type.startsWith("image/") ? blob.type : /^image\/[a-z0-9][a-z0-9.+-]*$/iu.test(media.mimeType) ? media.mimeType : blob.type
    url = child.URL.createObjectURL(new child.Blob([blob], {type: mimeType}))
    image = reserved.createElement("img")
    image.alt = media.label
    reserved.title = media.label
    const loaded = new Promise<void>((resolve, reject) => {
      const ready = () => {stopImage(); resolve()}
      const failed = () => {stopImage(); reject(new Error("Не удалось открыть оригинал изображения"))}
      const aborted = () => {stopImage(); reject(pendingSignal.reason)}
      stopImage = () => {
        image!.removeEventListener("load", ready)
        image!.removeEventListener("error", failed)
        pendingSignal.removeEventListener("abort", aborted)
      }
      image!.addEventListener("load", ready, {once: true})
      image!.addEventListener("error", failed, {once: true})
      pendingSignal.addEventListener("abort", aborted, {once: true})
    })
    reserved.body.append(image)
    image.src = url
    await loaded
    pendingSignal.throwIfAborted()
    if (!stillOwned()) throw new DOMException("Новая вкладка уже перешла к другому документу", "AbortError")
    // Больше нет parent callbacks в child Document. Browser самостоятельно
    // освобождает его URL при закрытии/навигации; закрытие overlay их не отзывает.
    url = undefined
  } catch (error) {
    stopImage()
    if (url !== undefined) child.URL.revokeObjectURL(url)
    if (stillOwned()) tab.close()
    throw error
  } finally {
    stopLoadAbort()
    child.removeEventListener("pagehide", pageHide)
  }
}
