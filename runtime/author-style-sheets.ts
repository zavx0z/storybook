import type {RootLinkedAuthorStyleSheet} from "@zavx0z/browser/integration"

/** Reads only the server-indexed Workbench links on landing and fallback pages; it never scans native CSSOM. */
export function indexedWorkbenchAuthorStyleSheetSources(
  document: globalThis.Document,
): readonly RootLinkedAuthorStyleSheet[] {
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

function exactIndexedLinkText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be non-empty text`)
  }
  return value
}
