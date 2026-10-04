/**
Читает заданный сервером порядок авторских ссылок Workbench в native Document.
Сохраняет identity link для подключения в существующий Browser Root; не разбирает
CSS-текст и не восстанавливает список через обход CSSOM.

@packageDocumentation
*/
import type {StorybookAppWebPageStyleSheets} from "./contract"
import {exactIndexedLinkText} from "./src/indexed-link"
export type {StorybookAppWebPageStyleSheets} from "./contract"

/**
Проверяет ограниченный непрерывный индекс серверных stylesheet links.

@param document - Native Document landing или fallback страницы с серверными link.

@returns Неизменный список ссылок из того же Document в заданном сервером порядке.
При отсутствии возможностей поиска в переданном Document возвращает пустой список.

@throws При отсутствующей ссылке, дубликате specifier, неверном digest, адресе,
принадлежности link либо неуспешной загрузке после готовности Document.
*/
export default function indexedWorkbenchAuthorStyleSheetSources(
  document: StorybookAppWebPageStyleSheets.Input,
): StorybookAppWebPageStyleSheets.Output {
  if (typeof document.querySelectorAll !== "function" || typeof document.getElementById !== "function") {
    return Object.freeze([])
  }
  const annotated = [...document.querySelectorAll<HTMLLinkElement>(
    'link[data-external-storybook-author-style-sheet]',
  )]
  if (annotated.length > 32) throw new Error("Storybook Workbench author stylesheet list exceeds 32 links")
  const annotatedSet = new Set(annotated)
  const specifiers = new Set<string>()
  return Object.freeze(annotated.map((_candidate, index) => {
    const elementId = `external-storybook-author-style-sheet-${index}`
    const element = document.getElementById(elementId)
    if (element === null || !annotatedSet.has(element as HTMLLinkElement) ||
      element.localName.toLowerCase() !== "link") {
      throw new Error(`Required Storybook Workbench author stylesheet link is missing at index ${index}`)
    }
    const link = element as HTMLLinkElement
    const specifier = exactIndexedLinkText(
      link.getAttribute("data-external-storybook-author-style-sheet"),
      `Storybook Workbench author stylesheet ${index} specifier`,
    )
    const digest = exactIndexedLinkText(
      link.getAttribute("data-external-storybook-author-style-sheet-digest"),
      `Storybook Workbench author stylesheet ${specifier} digest`,
    )
    const href = exactIndexedLinkText(
      link.getAttribute("href"),
      `Storybook Workbench author stylesheet ${specifier} href`,
    )
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`Storybook Workbench author stylesheet digest is invalid: ${specifier}`)
    }
    if (!href.startsWith("/") || /[\u0000-\u001f\u007f]/u.test(href)) {
      throw new Error(`Storybook Workbench author stylesheet href is invalid: ${specifier}`)
    }
    if (specifier.includes("\\") || specifiers.has(specifier)) {
      throw new Error(`Storybook Workbench author stylesheet specifier is invalid or duplicate: ${specifier}`)
    }
    specifiers.add(specifier)
    if (link.ownerDocument !== document || link.getAttribute("rel") !== "stylesheet") {
      throw new Error(`Storybook Workbench author stylesheet link belongs to another realm: ${specifier}`)
    }
    if ((document.readyState === "interactive" || document.readyState === "complete") && link.sheet === null) {
      throw new Error(`Required Storybook Workbench author stylesheet failed before entry: ${specifier}`)
    }
    return Object.freeze({id: specifier, link})
  }))
}
