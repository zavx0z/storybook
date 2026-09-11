import type {Element} from "@zavx0z/dom"
import type {StorybookPackageRevisionAuthorStyleSheet} from "../sessions/package-revision.ts"
import type {ExternalStorybookShell} from "./shell.ts"

/**
Транзакция candidate stylesheet set относительно текущего active set.

@property commit - Загружает semantic links и только после успеха снимает прежний набор.

@property rollback - Удаляет candidate и отдельным bounded cleanup signal возвращает прежние links.

@property release - Завершает успешную транзакцию либо удаляет ещё не committed candidate.
*/
export type StorybookPreparedPackageStyleSheets = Readonly<{
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
}>

/**
Создаёт владельца package author styles в semantic Document текущего shell.

Stable Workbench sheets остаются borrowed ресурсами Root. {@link StorybookPreparedPackageStyleSheets.commit}
добавляет candidate links, ждёт их semantic `load` и затем удаляет прежний set;
{@link StorybookPreparedPackageStyleSheets.rollback} восстанавливает его без
использования уже отменённого transition signal. Root и native Canvas не меняются.

@param shell - Единственный page-owned {@link ExternalStorybookShell}.

@param timeoutMs - Бюджет одной загрузки или cleanup в миллисекундах `[1..30000]`.

@returns Owner с `prepare` для revision transaction и `clear` для final page cleanup.

@throws При отсутствии semantic root, ошибке link, abort или выходе timeoutMs за диапазон.
*/
export function createStorybookPackageStyleSheetOwner(
  shell: ExternalStorybookShell,
  timeoutMs = 8_000,
) {
  let active: readonly Element[] = Object.freeze([])

  const prepare = async (
    revisionUrl: string,
    styleSheets: readonly StorybookPackageRevisionAuthorStyleSheet[],
    signal: AbortSignal,
  ): Promise<StorybookPreparedPackageStyleSheets> => {
    const candidate = Object.freeze(styleSheets.map((styleSheet, index) => {
      const link = shell.document.createElement("link")
      link.setAttribute("rel", "stylesheet")
      link.setAttribute("href", `${revisionUrl}${styleSheet.url}`)
      link.setAttribute("data-external-storybook-package-style", styleSheet.specifier)
      link.setAttribute("data-external-storybook-package-style-digest", styleSheet.contentDigest)
      link.setAttribute("data-external-storybook-package-style-index", String(index))
      return link
    }))
    let previous: readonly Element[] | null = null
    let committed = false
    let released = false
    return Object.freeze({
      async commit() {
        if (released || committed) return
        previous = active
        await appendAndWait(shell, candidate, signal, timeoutMs)
        committed = true
        active = candidate
        for (const link of previous) link.remove()
      },
      async rollback() {
        if (released) return
        for (const link of candidate) link.remove()
        if (committed && previous !== null && previous.length > 0) {
          await appendAndWait(shell, previous, AbortSignal.timeout(timeoutMs), timeoutMs)
        }
        if (previous !== null) active = previous
        committed = false
      },
      release() {
        if (released) return
        released = true
        if (!committed) {
          for (const link of candidate) link.remove()
        }
      },
    })
  }

  const clear = (): void => {
    for (const link of active) link.remove()
    active = Object.freeze([])
  }

  return Object.freeze({prepare, clear})
}

/** Добавляет один ordered set атомарной mutation и ждёт load каждого semantic link. */
async function appendAndWait(
  shell: ExternalStorybookShell,
  links: readonly Element[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  signal.throwIfAborted()
  if (links.length === 0) return
  const documentElement = shell.document.documentElement
  if (documentElement === null) throw new Error("Storybook semantic Document has no root element")
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new RangeError("Storybook package stylesheet timeout must be between 1 and 30000 ms")
  }
  const loaded = links.map(link => waitForStyleSheet(link, signal, timeoutMs))
  shell.document.transaction(() => {
    for (const link of links) documentElement.append(link)
  })
  await Promise.all(loaded)
}

/** Связывает semantic load/error, abort и bounded timeout одной ссылки. */
function waitForStyleSheet(
  link: Element,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("Storybook package stylesheet load timed out")), timeoutMs)
    const onLoad = () => finish()
    const onError = () => finish(new Error(`Storybook package stylesheet failed: ${link.getAttribute("href") ?? "unknown"}`))
    const onAbort = () => finish(signal.reason ?? new DOMException("Aborted", "AbortError"))
    const finish = (error?: unknown) => {
      clearTimeout(timeout)
      link.removeEventListener("load", onLoad)
      link.removeEventListener("error", onError)
      signal.removeEventListener("abort", onAbort)
      if (error === undefined) resolve()
      else reject(error)
    }
    link.addEventListener("load", onLoad, {once: true})
    link.addEventListener("error", onError, {once: true})
    signal.addEventListener("abort", onAbort, {once: true})
  })
}
