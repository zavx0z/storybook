import {isAbsolute, normalize} from "node:path"
import {
  validateExternalStorybookExportName,
  validateExternalStorybookPackageId,
  validateExternalStorybookRoute,
  validateExternalStorybookScopeId,
} from "../discovery/declaration-law.ts"

export type StorybookGeneratedModule = Readonly<{
  path: string
  export: string
}>

export type StorybookGeneratedVariant = Readonly<{
  route: string
  module: StorybookGeneratedModule
}>

export type StorybookGeneratedWidget = Readonly<{
  id: string
  module: StorybookGeneratedModule
}>

export type StorybookGeneratedLoaderInput = Readonly<{
  revisionUrl: string
  runtime: StorybookGeneratedModule | null
  variants: readonly StorybookGeneratedVariant[]
  widgets: readonly StorybookGeneratedWidget[]
}>

export const STORYBOOK_REVISION_PAYLOAD_FILE = "revision-payload.js" as const

export type StorybookGeneratedRevisionPayloadInput = Readonly<{
  packageId: string
  candidateRevision: string
  sharedModuleEpoch: string
  hostModuleEpoch?: string
  packageHostUrl?: string
  graphSnapshot: unknown
}>

/**
Generates one build-time module containing only literal canonical filesystem
imports that were validated before source emission. Bun resolves these imports
and rewrites them to immutable revision-scoped browser chunks.

The private route map prevents a declaration value from becoming an arbitrary
browser import. A successful later candidate is published below a different
immutable `revisionUrl`, so its rewritten chunks can be retried without reusing
the rejected browser module URL from an older revision.
*/
export function generateStorybookLoaderSource(
  input: StorybookGeneratedLoaderInput,
): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Storybook generated loader input must be an object")
  }
  if (!Array.isArray(input.variants)) throw new TypeError("Storybook generated loader variants must be a list")
  if (!Array.isArray(input.widgets)) throw new TypeError("Storybook generated loader widgets must be a list")
  const revisionUrl = validateRevisionUrl(input.revisionUrl)
  const runtime = input.runtime === null ? null : validateModule(input.runtime, "runtime")
  const routes = new Set<string>()
  const variants = input.variants.map((variant, index) => {
    if (variant === null || typeof variant !== "object" || Array.isArray(variant)) {
      throw new TypeError(`Storybook variant ${index} must be an object`)
    }
    const route = validateExternalStorybookRoute(variant.route, `Storybook variant ${index} route`)
    if (routes.has(route)) throw new Error(`Duplicate Storybook variant route: ${route}`)
    routes.add(route)
    return Object.freeze({
      route,
      module: validateModule(variant.module, `variant ${route}`),
    })
  }).sort((left, right) => left.route < right.route ? -1 : left.route > right.route ? 1 : 0)
  const widgetIds = new Set<string>()
  const widgets = input.widgets.map((widget, index) => {
    if (widget === null || typeof widget !== "object" || Array.isArray(widget)) {
      throw new TypeError(`Storybook widget ${index} must be an object`)
    }
    const id = validateExternalStorybookScopeId(widget.id, `Storybook widget ${index} id`)
    if (widgetIds.has(id)) throw new Error(`Duplicate Storybook widget id: ${id}`)
    widgetIds.add(id)
    return Object.freeze({id, module: validateModule(widget.module, `widget ${id}`)})
  })

  const routeEntries = variants.map(({route, module}) => [
    `  [${jsString(route)}, () =>`,
    `    import(${jsString(module.url)}).then((namespace) => namespace[${jsString(module.export)}])],`,
  ].join("\n")).join("\n")
  const routeValues = variants.map(({route}) => `  ${jsString(route)},`).join("\n")
  const widgetEntries = widgets.map(({id, module}) => [
    `  [${jsString(id)}, () =>`,
    `    import(${jsString(module.url)}).then((namespace) => namespace[${jsString(module.export)}])],`,
  ].join("\n")).join("\n")
  const widgetValues = widgets.map(({id}) => `  ${jsString(id)},`).join("\n")

  return [
    ...(runtime === null
      ? [`const runtimeLoader = null`]
      : [
        `const runtimeLoader = () =>`,
        `  import(${jsString(runtime.url)}).then((namespace) => namespace[${jsString(runtime.export)}])`,
      ]),
    ``,
    `export const STORYBOOK_PACKAGE_STORY_LOADERS = new Map([`,
    routeEntries,
    `])`,
    ``,
    `export const storybookRevisionUrl = ${jsString(revisionUrl)}`,
    `export const storybookVariantRoutes = Object.freeze([`,
    routeValues,
    `])`,
    `export const STORYBOOK_PACKAGE_WIDGET_LOADERS = new Map([`,
    widgetEntries,
    `])`,
    `export const storybookWidgetContributionIds = Object.freeze([`,
    widgetValues,
    `])`,
    ``,
    ...(runtime === null
      ? [`export const loadStorybookPackageRuntime = null`]
      : [
        `export function loadStorybookPackageRuntime() {`,
        `  return runtimeLoader()`,
        `}`,
      ]),
    ``,
    `export function loadStorybookVariant(route) {`,
    `  const loader = STORYBOOK_PACKAGE_STORY_LOADERS.get(route)`,
    `  if (loader === undefined) {`,
    `    throw new Error("Unknown Storybook variant route: " + String(route))`,
    `  }`,
    `  return loader()`,
    `}`,
    ``,
    `export function loadStorybookWidget(id) {`,
    `  const loader = STORYBOOK_PACKAGE_WIDGET_LOADERS.get(id)`,
    `  if (loader === undefined) {`,
    `    throw new Error("Unknown Storybook widget contribution: " + String(id))`,
    `  }`,
    `  return loader()`,
    `}`,
    ``,
  ].join("\n")
}

/** Генерирует entry revision payload без side effects для обновления внутри страницы. */
export function generateStorybookRevisionPayloadSource(
  input: StorybookGeneratedRevisionPayloadInput,
): string {
  const packageId = validateExternalStorybookPackageId(input.packageId, "Storybook revision payload package")
  if (typeof input.candidateRevision !== "string" ||
    !/^[A-Za-z0-9_-]{1,256}$/u.test(input.candidateRevision)) {
    throw new Error(`Invalid Storybook candidate revision: ${String(input.candidateRevision)}`)
  }
  if (typeof input.sharedModuleEpoch !== "string" || input.sharedModuleEpoch.length === 0 ||
    input.sharedModuleEpoch.length > 256 || hasControlCharacter(input.sharedModuleEpoch)) {
    throw new Error(`Invalid Storybook shared module epoch: ${String(input.sharedModuleEpoch)}`)
  }
  if (input.graphSnapshot === null || typeof input.graphSnapshot !== "object" || Array.isArray(input.graphSnapshot)) {
    throw new TypeError("Storybook revision payload graph snapshot must be an object")
  }
  if (input.packageHostUrl !== undefined && (!input.packageHostUrl.startsWith("/__storybook/shared/") ||
    !input.packageHostUrl.endsWith(".js") || input.packageHostUrl.includes("..") || hasControlCharacter(input.packageHostUrl))) {
    throw new Error("Invalid Storybook package host URL")
  }
  return [
    ...(input.packageHostUrl === undefined ? [] : [
      `import {startExternalStorybookPackage} from ${jsString(input.packageHostUrl)}`,
    ]),
    "import {",
    "  loadStorybookPackageRuntime,",
    "  STORYBOOK_PACKAGE_STORY_LOADERS,",
    "  STORYBOOK_PACKAGE_WIDGET_LOADERS,",
    "  storybookRevisionUrl,",
    "} from \"./generated-loaders.ts\"",
    "",
    "export const STORYBOOK_APPLIED_REVISION = Object.freeze({",
    "  protocol: \"storybook-page-realm/1\",",
    `  packageId: ${jsString(packageId)},`,
    `  candidateRevision: ${jsString(input.candidateRevision)},`,
    `  sharedModuleEpoch: ${jsString(input.sharedModuleEpoch)},`,
    ...(input.hostModuleEpoch === undefined
      ? []
      : [`  hostModuleEpoch: ${jsString(validateModuleEpoch(input.hostModuleEpoch, "host"))},`]),
    "  revisionUrl: storybookRevisionUrl,",
    `  graphSnapshot: ${JSON.stringify(input.graphSnapshot)},`,
    ...(input.packageHostUrl === undefined ? [] : ["  startPackage: startExternalStorybookPackage,"]),
    "  loadRuntime: loadStorybookPackageRuntime,",
    "  storyLoaders: STORYBOOK_PACKAGE_STORY_LOADERS,",
    "  widgetLoaders: STORYBOOK_PACKAGE_WIDGET_LOADERS,",
    "})",
    "",
  ].join("\n")
}

function validateModuleEpoch(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || hasControlCharacter(value)) {
    throw new Error(`Invalid Storybook ${label} module epoch: ${String(value)}`)
  }
  return value
}

/** Генерирует один bounded browser importer immutable payload ревизии пакета. */
export function generateStorybookAppliedRevisionLoaderSource(packageIdValue: string): string {
  const packageId = validateExternalStorybookPackageId(
    packageIdValue,
    "Storybook applied revision loader package",
  )
  const revisionBaseUrl = `/__storybook/revisions/${encodeURIComponent(packageId)}/`
  return [
    "async function loadAppliedRevision(revision, signal) {",
    "  if (typeof revision !== \"string\" || !/^[A-Za-z0-9_-]{1,256}$/.test(revision)) {",
    "    throw new Error(\"Invalid Storybook applied revision: \" + String(revision))",
    "  }",
    "  signal.throwIfAborted()",
    `  const url = ${jsString(revisionBaseUrl)} + revision + \"/${STORYBOOK_REVISION_PAYLOAD_FILE}\"`,
    "  const namespace = await import(url)",
    "  signal.throwIfAborted()",
    "  const payload = namespace.STORYBOOK_APPLIED_REVISION",
    "  if (payload === null || typeof payload !== \"object\" ||",
    "    payload.protocol !== \"storybook-page-realm/1\") {",
    "    throw new Error(\"Invalid Storybook applied revision payload: \" + revision)",
    "  }",
    "  return payload",
    "}",
    "",
  ].join("\n")
}

function validateModule(
  value: StorybookGeneratedModule,
  label: string,
): Readonly<{url: string; export: string}> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Storybook ${label} module must be an object`)
  }
  const path = validateModulePath(value.path, label)
  const exportName = validateExternalStorybookExportName(value.export, `Storybook ${label} export`)
  return Object.freeze({
    url: path,
    export: exportName,
  })
}

function validateRevisionUrl(value: string): string {
  if (typeof value !== "string" || value.length < 3 ||
    !value.startsWith("/") || !value.endsWith("/") ||
    value.includes("\\") || value.includes("?") || value.includes("#") ||
    value.includes("//") || hasControlCharacter(value)) {
    throw new Error(`Invalid Storybook revision URL: ${String(value)}`)
  }
  let parsed: URL
  try {
    parsed = new URL(value, "https://storybook.invalid")
  } catch (error) {
    throw new Error(`Invalid Storybook revision URL: ${value}`, {cause: error})
  }
  if (parsed.origin !== "https://storybook.invalid" || parsed.pathname !== value ||
    parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`Invalid Storybook revision URL: ${value}`)
  }
  const segments = value.slice(1, -1).split("/")
  if (segments.length !== 4 || segments[0] !== "__storybook" || segments[1] !== "revisions" ||
    !validEncodedPackageSegment(segments[2]!) ||
    segments[3]!.length === 0 || unsafeDecodedSegment(segments[3]!)) {
    throw new Error(`Invalid Storybook revision URL: ${value}`)
  }
  return value
}

function validEncodedPackageSegment(value: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  if (encodeURIComponent(decoded) !== value) return false
  try {
    validateExternalStorybookPackageId(decoded, "Storybook revision package")
    return true
  } catch {
    return false
  }
}

function validateModulePath(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value) ||
    value.endsWith("/") || value.includes("\\") || value.includes("?") ||
    value.includes("#") || value.includes("//") || hasControlCharacter(value)) {
    throw new Error(`Invalid Storybook ${label} module path: ${String(value)}`)
  }
  const normalized = normalize(value)
  const segments = normalized.split("/").slice(1)
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`Invalid Storybook ${label} module path: ${value}`)
  }
  if (normalized !== value) throw new Error(`Storybook ${label} module path is not canonical: ${value}`)
  return normalized
}

function unsafeDecodedSegment(value: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return true
  }
  return decoded === "." || decoded === ".." ||
    decoded.includes("/") || decoded.includes("\\") || hasControlCharacter(decoded)
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value)
}

function jsString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
}
