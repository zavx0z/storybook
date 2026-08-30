import {
  readDocumentAuthorStyleSheets,
  type Document as SemanticDocument,
} from "@zavx0z/dom"

export type StorybookRuntimeStyleSheetRoot = Readonly<{
  readStyleSheets(): unknown
}>

export type StorybookStructuredSource = Readonly<{
  html: string
  css: Readonly<{
    authorStyleSheets: readonly Readonly<{
      specifier: string
      cssText: string
    }>[]
    componentStyleSheets: readonly Readonly<{
      moduleId: string
      componentName: string
      cssText: string
    }>[]
  }>
  typescript: string
}>

/**
 * Projects exact global author resources and exact active-root authored CSS.
 * Generated execution selectors and document-wide compiled registries are
 * deliberately outside this source boundary.
 */
export function projectStorybookSource(
  value: unknown,
  componentRoot: StorybookRuntimeStyleSheetRoot,
  document: SemanticDocument,
  authorStyleSheetSpecifiers: readonly string[],
): StorybookStructuredSource {
  const input = exactSourceInput(value)
  const rootSnapshot = exactRootSnapshot(componentRoot)
  const authorSnapshot = readDocumentAuthorStyleSheets(document)
  const authorById = new Map<string, (typeof authorSnapshot.styleSheets)[number]>()
  for (const styleSheet of authorSnapshot.styleSheets) {
    if (authorById.has(styleSheet.id)) {
      throw new Error(`Duplicate Storybook author stylesheet registry id: ${styleSheet.id}`)
    }
    authorById.set(styleSheet.id, styleSheet)
  }
  const declaredIds = new Set<string>()
  const authorStyleSheets = Object.freeze(authorStyleSheetSpecifiers.map((value, index) => {
    const specifier = exactText(value, `author stylesheet ${index} specifier`)
    if (declaredIds.has(specifier)) {
      throw new Error(`Duplicate Storybook package author stylesheet specifier: ${specifier}`)
    }
    declaredIds.add(specifier)
    const styleSheet = authorById.get(specifier)
    if (styleSheet === undefined) {
      throw new Error(`Storybook package author stylesheet is absent from the exact registry: ${specifier}`)
    }
    return Object.freeze({specifier, cssText: styleSheet.cssText})
  }))

  const seenSources = new Set<string>()
  const componentStyleSheets: Array<StorybookStructuredSource["css"]["componentStyleSheets"][number]> = []
  for (const [index, styleSheet] of rootSnapshot.styleSheets.entries()) {
    const record = exactRecord(styleSheet, `component stylesheet ${index}`)
    if (record.source === null || typeof record.source !== "object" || Array.isArray(record.source)) {
      throw new Error(`Storybook source build has no authored CSS provenance for component stylesheet ${index}`)
    }
    const source = record.source as Record<string, unknown>
    if (source.kind !== "authored-css") {
      throw new Error(`Storybook source build has no authored CSS provenance for component stylesheet ${index}`)
    }
    const moduleId = exactText(source.moduleId, `component stylesheet ${index} moduleId`)
    const componentName = exactText(source.componentName, `component stylesheet ${index} componentName`)
    const cssText = exactText(source.cssText, `component stylesheet ${index} cssText`, true)
    const identity = `${moduleId}\0${componentName}\0${cssText}`
    if (seenSources.has(identity)) continue
    seenSources.add(identity)
    componentStyleSheets.push(Object.freeze({moduleId, componentName, cssText}))
  }

  return Object.freeze({
    html: input.html,
    css: Object.freeze({
      authorStyleSheets,
      componentStyleSheets: Object.freeze(componentStyleSheets),
    }),
    typescript: input.typescript,
  })
}

function exactSourceInput(value: unknown): Readonly<{html: string; typescript: string}> {
  const record = exactRecord(value, "Storybook source")
  const keys = Object.keys(record).sort()
  if (keys.length !== 2 || keys[0] !== "html" || keys[1] !== "typescript") {
    throw new TypeError("Storybook source must contain exactly html and typescript")
  }
  return Object.freeze({
    html: exactText(record.html, "Storybook source html", true),
    typescript: exactText(record.typescript, "Storybook source typescript", true),
  })
}

function exactRootSnapshot(
  value: StorybookRuntimeStyleSheetRoot,
): Readonly<{revision: number; styleSheets: readonly unknown[]}> {
  const root = exactRecord(value, "Storybook component root")
  if (typeof root.readStyleSheets !== "function") {
    throw new TypeError("Storybook component root must expose readStyleSheets()")
  }
  const snapshot = exactRecord(root.readStyleSheets(), "Storybook component root stylesheet snapshot")
  if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0) {
    throw new TypeError("Storybook component root stylesheet revision must be a non-negative integer")
  }
  if (!Array.isArray(snapshot.styleSheets)) {
    throw new TypeError("Storybook component root styleSheets must be a list")
  }
  return Object.freeze({
    revision: snapshot.revision as number,
    styleSheets: snapshot.styleSheets,
  })
}

function exactRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactText(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be ${allowEmpty ? "text" : "non-empty text"}`)
  }
  return value
}
