import type {StorybookSharedHost} from "../contract/host"

/** Загружает только опубликованный сервером host, не исполняя код пакета или его pinned host. */
export async function readStorybookSharedHost(
  fetcher: typeof fetch,
  readerToken: string,
  signal: AbortSignal,
  sharedModuleEpoch?: string,
  preview = false,
): Promise<StorybookSharedHost> {
  const parameters = new URLSearchParams()
  if (sharedModuleEpoch !== undefined) parameters.set("sharedModuleEpoch", sharedModuleEpoch)
  if (preview) parameters.set("preview", "1")
  const query = parameters.size === 0 ? "" : `?${parameters}`
  const response = await fetcher(`/api/browser/shared${query}`, {
    headers: {"x-storybook-session": readerToken}, signal,
  })
  if (!response.ok) throw new Error(`Общая оболочка Storybook недоступна для платформы ${sharedModuleEpoch ?? "текущей"}: ${response.status}`)
  const host = validateStorybookSharedHost(await response.json())
  if (sharedModuleEpoch !== undefined && host.sharedModuleEpoch !== sharedModuleEpoch) {
    throw new Error("Оболочка Storybook вернула другую платформу")
  }
  return host
}

/** Проверяет origin-relative immutable адреса до любого dynamic import. */
export function validateStorybookSharedHost(value: unknown): StorybookSharedHost {
  if (value === null || typeof value !== "object") throw new Error("Некорректное описание оболочки Storybook")
  const host = value as StorybookSharedHost
  if (host.protocol !== "storybook-shared-host/1" || !epoch(host.sharedModuleEpoch) || !epoch(host.hostModuleEpoch)
    || !sharedUrl(host.pageEntryUrl) || !Array.isArray(host.authorStyleSheets)
    || host.authorStyleSheets.length > 32 || host.authorStyleSheets.some(style => !style ||
      typeof style.specifier !== "string" || !style.specifier || !epoch(style.contentDigest) || !sharedUrl(style.url))
    || new Set(host.authorStyleSheets.map(style => style.specifier)).size !== host.authorStyleSheets.length) {
    throw new Error("Некорректное описание оболочки Storybook")
  }
  return host
}

/** Импортирует page controller подтверждённого host; его platform imports уже согласованы с payload. */
export async function importStorybookSharedHost<Start extends (...args: never[]) => unknown>(
  host: StorybookSharedHost,
): Promise<Start> {
  const module = await import(validateStorybookSharedHost(host).pageEntryUrl)
  if (typeof module.default !== "function") throw new Error("У оболочки Storybook отсутствует page controller")
  return module.default as Start
}

/** SHA-256 обозначает точную опубликованную модульную среду. */
function epoch(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
}

/** Shared URL не допускает смену origin, traversal или query-dependent module identity. */
function sharedUrl(value: unknown): value is string {
  return typeof value === "string" && /^\/__storybook\/shared\/[A-Za-z0-9_./-]+$/u.test(value)
    && !value.split("/").some(part => part === "." || part === "..")
}

/** Обновляет настоящие author links; browser stylesheet host наблюдает те же элементы. */
export async function synchronizeStorybookHostStyles(document: Document, host: StorybookSharedHost): Promise<() => void> {
  if (host.authorStyleSheets.length === 0 && typeof document.querySelectorAll !== "function") return () => {}
  const previous = [...document.querySelectorAll<HTMLLinkElement>('link[data-external-storybook-author-style-sheet]')]
    .map(link => ({link, href: link.getAttribute("href"), specifier: link.getAttribute("data-external-storybook-author-style-sheet"),
      digest: link.getAttribute("data-external-storybook-author-style-sheet-digest")}))
  const created: HTMLLinkElement[] = []
  const restore = () => {
    for (const link of created) link.remove()
    for (const item of previous) {
      item.link.setAttribute("href", item.href ?? "")
      item.link.setAttribute("data-external-storybook-author-style-sheet", item.specifier ?? "")
      item.link.setAttribute("data-external-storybook-author-style-sheet-digest", item.digest ?? "")
      document.head.append(item.link)
    }
  }
  try {
    for (const [index, style] of host.authorStyleSheets.entries()) {
      let link = previous[index]?.link
      if (link && previous[index]?.href === style.url && previous[index]?.digest === style.contentDigest) continue
      if (!link) {
        link = document.createElement("link")
        created.push(link)
      }
      const target = link
      target.id = `external-storybook-author-style-sheet-${index}`
      target.rel = "stylesheet"
      target.setAttribute("data-external-storybook-author-style-sheet", style.specifier)
      target.setAttribute("data-external-storybook-author-style-sheet-digest", style.contentDigest)
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout)
          target.removeEventListener("load", loaded)
          target.removeEventListener("error", failed)
        }
        const loaded = () => {
          cleanup()
          resolve()
        }
        const failed = () => {
          cleanup()
          reject(new Error(`Не загружен стиль оболочки: ${style.specifier}`))
        }
        const timeout = setTimeout(failed, 10000)
        target.addEventListener("load", loaded, {once: true})
        target.addEventListener("error", failed, {once: true})
        target.href = style.url
        document.head.append(target)
      })
    }
    for (const item of previous.slice(host.authorStyleSheets.length)) item.link.remove()
    return restore
  } catch (error) {
    restore()
    throw error
  }
}
