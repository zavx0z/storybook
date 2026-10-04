/**
Готовит браузерные загрузчики проверенных структурных сценариев и ревизий.
Серверные примеры передаются результатами, а браузерные компоненты связываются по точной идентичности.

@packageDocumentation
*/
import {isAbsolute, normalize} from "node:path"
import type {StorybookSpecsScenariosReader} from "@storybook-specs-scenarios/reader"
import type {
  GeneratedScenario as StorybookGeneratedScenario,
  LoaderInput as StorybookGeneratedLoaderInput,
  RevisionPayloadInput as StorybookGeneratedRevisionPayloadInput,
} from "./contract/loader"
import type {StorybookPackageBuildLoader} from "./contract"

export type {StorybookPackageBuildLoader} from "./contract"
/** Форма исходного публичного владельца. */
type StorybookAppWebPagePackageScenarioPreview = NonNullable<StorybookSpecsScenariosReader.Output["preview"]>
type StorybookGeneratedModule = Readonly<{path: string; export: string}>
type StorybookGeneratedScenarioVariant = Extract<StorybookAppWebPagePackageScenarioPreview, {kind: "component"}>["variants"][number]
import Identity from "@storybook-package/identity"
const {
  export: validateExternalStorybookExportName,
  package: validateExternalStorybookPackageId,
} = Identity

type FunctionScenarioVariant = Extract<StorybookAppWebPagePackageScenarioPreview, {kind: "function"}>["variants"][number]

const STORYBOOK_REVISION_PAYLOAD_FILE = "revision-payload.js" as const


/**
Генерирует загрузчики подготовленных структурных сценариев.
Компонент получает буквальный импорт проверенного модуля; результат сценария
функции передаётся как данные без импорта серверного кода в браузер.
Слоты варианта компилируются отдельно и передаются через штатный slotContents
Template; JSON props остаются свойствами описываемого компонента.

Карта по идентификаторам владельцев не допускает произвольного браузерного импорта.
Bun связывает модули с неизменяемыми ресурсами конкретной ревизии. Следующая
ревизия получает собственный адрес, поэтому не переиспользует модуль отклонённого
кандидата.
*/
function generateStorybookLoaderSource(
  input: StorybookGeneratedLoaderInput,
): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Storybook generated loader input must be an object")
  }
  if (input.scenarios !== undefined && !Array.isArray(input.scenarios)) {
    throw new TypeError("Storybook generated loader scenarios must be a list")
  }
  const revisionUrl = validateRevisionUrl(input.revisionUrl)
  const scenarioNodeIds = new Set<string>()
  const scenarios = (input.scenarios ?? []).map((scenario, index) => {
    if (scenario === null || typeof scenario !== "object" || Array.isArray(scenario)) {
      throw new TypeError(`Storybook scenario ${index} must be an object`)
    }
    const nodeId = validateGraphNodeId(scenario.nodeId, `Storybook scenario ${index} nodeId`)
    if (scenarioNodeIds.has(nodeId)) throw new Error(`Duplicate Storybook scenario node: ${nodeId}`)
    scenarioNodeIds.add(nodeId)
    if (!Array.isArray(scenario.variants)) {
      throw new TypeError(`Storybook scenario variants must be a list: ${nodeId}`)
    }
    if (scenario.kind === "function") {
      if (Object.hasOwn(scenario, "module")) throw new TypeError("Серверный модуль не входит в браузерное представление функции")
      return Object.freeze({nodeId, kind: "function" as const, variants: validateFunctionVariants(scenario.variants, nodeId)})
    }
    if (scenario.kind !== "component") throw new TypeError(`Unknown Storybook scenario kind: ${nodeId}`)
    return Object.freeze({
      nodeId,
      kind: "component" as const,
      module: validateModule(scenario.module, `scenario ${nodeId}`),
      variants: validateScenarioVariants(scenario.variants, nodeId),
    })
  }).sort((left, right) => left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0)

  const scenarioVariants = scenarios.map(({variants}, index) =>
    `const scenarioVariants${index} = Object.freeze(${jsonSource(variants, `scenario ${index} variants`)})`
  ).join("\n")
  const scenarioEntries = scenarios.map((scenario, index) => scenario.kind === "function" ? [
    `  [${jsString(scenario.nodeId)}, () => Promise.resolve(Object.freeze({`,
    `    kind: "function", variants: scenarioVariants${index},`,
    `  }))],`,
  ].join("\n") : [
    `  [${jsString(scenario.nodeId)}, () =>`,
    `    Promise.all([import(${jsString(scenario.module.url)})${jsxEntries(scenario.variants, index).map(entry => `, import(${jsString(entry.path)})`).join("")}]).then(([namespace, ...jsxModules]) => Object.freeze({`,
    `      kind: "component",`,
    `      template: namespace[${jsString(scenario.module.export)}],`,
    ...(jsxEntries(scenario.variants, index).length || scenario.variants.some(variant => variant.slots !== undefined) ? [
      `      resolveProps: (id, props) => {`,
      `        const entries = ${JSON.stringify(jsxEntries(scenario.variants, index).map(({id, property, target}) => ({id, property, target})))}`,
      `        const values = target => Object.fromEntries(entries.flatMap((entry, i) => entry.id === id && entry.target === target ? [[entry.property, bindStorybookJsx(jsxModules[i].ScenarioJsx, {})]] : []))`,
      ...(scenario.variants.some(variant => variant.slots !== undefined) ? [
        `        return {...values("props"), ...props, [storybookSlotContents]: Object.fromEntries(Object.entries(values("slots")).map(([name, value]) => [name === "default" ? "" : name, [value]]))}`,
      ] : [`        return {...values("props"), ...props}`]),
      `      },`,
    ] : []),
    `      variants: scenarioVariants${index},`,
    `    }))],`,
  ].join("\n")).join("\n")

  return [
    ...(scenarios.some(scenario => scenario.kind === "component" && scenario.variants.some(variant => variant.jsxProps || variant.slots !== undefined))
      ? ['import {component as bindStorybookJsx} from "@immersive/component"'] : []),
    ...(scenarios.some(scenario => scenario.kind === "component" && scenario.variants.some(variant => variant.slots !== undefined))
      ? ['import {slotContents as storybookSlotContents} from "@immersive/template/compiled"'] : []),
    scenarioVariants,
    `export const storybookRevisionUrl = ${jsString(revisionUrl)}`,
    `export const STORYBOOK_PACKAGE_SCENARIO_LOADERS = new Map([`,
    scenarioEntries,
    `])`,
    ``,
  ].join("\n")
}

/** Генерирует entry revision payload без side effects для обновления внутри страницы. */
function generateStorybookRevisionPayloadSource(
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
  return [
    "import {",
    "  STORYBOOK_PACKAGE_SCENARIO_LOADERS,",
    "  storybookRevisionUrl,",
    "} from \"./generated-loaders.ts\"",
    "",
    "export const STORYBOOK_APPLIED_REVISION = Object.freeze({",
    "  protocol: \"storybook-page-realm/1\",",
    `  packageId: ${jsString(packageId)},`,
    `  candidateRevision: ${jsString(input.candidateRevision)},`,
    `  sharedModuleEpoch: ${jsString(input.sharedModuleEpoch)},`,
    "  revisionUrl: storybookRevisionUrl,",
    `  graphSnapshot: ${JSON.stringify(input.graphSnapshot)},`,
    "  scenarioLoaders: STORYBOOK_PACKAGE_SCENARIO_LOADERS,",
    "})",
    "",
  ].join("\n")
}



/** Генерирует один bounded browser importer immutable payload ревизии пакета. */
function generateStorybookAppliedRevisionLoaderSource(packageIdValue: string): string {
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

function validateGraphNodeId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048 || hasControlCharacter(value)) {
    throw new Error(`${label} must be bounded non-empty text without control characters`)
  }
  return value
}

function validateScenarioVariants(
  variants: readonly StorybookGeneratedScenarioVariant[],
  nodeId: string,
): readonly StorybookGeneratedScenarioVariant[] {
  const ids = new Set<string>()
  return Object.freeze(variants.map((variant, index) => {
    if (variant === null || typeof variant !== "object" || Array.isArray(variant)) {
      throw new TypeError(`Storybook scenario variant ${index} must be an object: ${nodeId}`)
    }
    const id = validateGraphNodeId(variant.id, `Storybook scenario variant ${index} id`)
    if (ids.has(id)) throw new Error(`Duplicate Storybook scenario variant id: ${nodeId}:${id}`)
    ids.add(id)
    const title = requiredScenarioText(variant.title, `Storybook scenario variant ${id} title`)
    if (variant.props === null || typeof variant.props !== "object" || Array.isArray(variant.props)) {
      throw new TypeError(`Storybook scenario variant props must be an object: ${nodeId}:${id}`)
    }
    if (typeof variant.source !== "string") {
      throw new TypeError(`Storybook scenario variant source must be text: ${nodeId}:${id}`)
    }
    if (!Array.isArray(variant.points)) {
      throw new TypeError(`Storybook scenario variant points must be a list: ${nodeId}:${id}`)
    }
    const points = Object.freeze(variant.points.map((point, pointIndex) => {
      if (point === null || typeof point !== "object" || Array.isArray(point)) {
        throw new TypeError(`Storybook scenario point ${pointIndex} must be an object: ${nodeId}:${id}`)
      }
      const pointTitle = requiredScenarioText(point.title, `Storybook scenario point ${pointIndex} title`)
      if (point.content !== undefined && typeof point.content !== "string") {
        throw new TypeError(`Storybook scenario point content must be text: ${nodeId}:${id}`)
      }
      return Object.freeze({
        title: pointTitle,
        ...(point.content === undefined ? {} : {content: point.content}),
      })
    }))
    const normalized = Object.freeze({id, title, props: variant.props, source: variant.source, points,
      ...(variant.path === undefined ? {} : {path: variant.path}),
      ...(variant.selection === undefined ? {} : {selection: variant.selection}),
      ...(variant.jsxProps === undefined ? {} : {jsxProps: variant.jsxProps}),
      ...(variant.slots === undefined ? {} : {slots: variant.slots})})
    jsonSource(normalized, `scenario variant ${nodeId}:${id}`)
    return normalized
  }))
}

function requiredScenarioText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || hasControlCharacter(value)) {
    throw new Error(`${label} must be non-empty text without control characters`)
  }
  return value
}

/** Проверяет готовые снимки; этот путь не принимает модуль или callback функции. */
function validateFunctionVariants(variants: readonly FunctionScenarioVariant[], nodeId: string): readonly FunctionScenarioVariant[] {
  const ids = new Set<string>()
  return Object.freeze(variants.map(variant => {
    if (variant === null || typeof variant !== "object") throw new TypeError(`Invalid function variant: ${nodeId}`)
    const id = validateGraphNodeId(variant.id, "Function variant id")
    if (ids.has(id)) throw new Error(`Duplicate Storybook scenario variant id: ${nodeId}:${id}`)
    ids.add(id)
    const title = requiredScenarioText(variant.title, "Function variant title")
    if (typeof variant.source !== "string" || !Array.isArray(variant.points) || !Array.isArray(variant.calls)) {
      throw new TypeError(`Invalid function variant data: ${nodeId}:${id}`)
    }
    const points = variant.points.map(point => {
      const title = requiredScenarioText(point.title, "Function point title")
      if (point.content !== undefined && typeof point.content !== "string") throw new TypeError("Invalid function point content")
      return {title, ...(point.content === undefined ? {} : {content: point.content})}
    })
    const callIds = new Set<number>()
    const calls = variant.calls.map(call => {
      if (!Number.isSafeInteger(call.id) || call.id < 0 || callIds.has(call.id) || typeof call.source !== "string") throw new TypeError("Invalid function call")
      callIds.add(call.id)
      const outcome = call.outcome
      if (!outcome || !["return", "resolve", "throw", "reject"].includes(outcome.type)
        || !Object.hasOwn(outcome, outcome.type === "return" || outcome.type === "resolve" ? "value" : "error")) throw new TypeError("Invalid function outcome")
      return {id: call.id, source: call.source, outcome}
    })
    const normalized = {id, title, source: variant.source, points, calls,
      ...(variant.props === undefined ? {} : {props: variant.props})}
    jsonSource(normalized, `function scenario ${nodeId}:${id}`)
    return Object.freeze(normalized)
  }))
}

function jsonSource(value: unknown, label: string): string {
  validateJsonValue(value, label, new Set())
  let source: string | undefined
  try {
    source = JSON.stringify(value)
  } catch (error) {
    throw new TypeError(`Storybook ${label} must contain JSON values`, {cause: error})
  }
  if (source === undefined) throw new TypeError(`Storybook ${label} must contain JSON values`)
  return source
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
}

function validateJsonValue(value: unknown, label: string, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Storybook ${label} must contain finite JSON numbers`)
    return
  }
  if (typeof value !== "object") throw new TypeError(`Storybook ${label} must contain JSON values`)
  if (ancestors.has(value)) throw new TypeError(`Storybook ${label} must not contain cycles`)
  ancestors.add(value)
  if (Array.isArray(value)) {
    for (const item of value) validateJsonValue(item, label, ancestors)
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Storybook ${label} must contain plain JSON objects`)
    }
    for (const item of Object.values(value)) validateJsonValue(item, label, ancestors)
  }
  ancestors.delete(value)
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

/** Тот же порядок модулей используется при записи файлов и построении lazy loader. */
function jsxEntries(variants: readonly StorybookGeneratedScenarioVariant[], scenarioIndex: number) {
  return variants.flatMap((variant, variantIndex) => [
    ...Object.entries(variant.jsxProps ?? {}).map(([property, value]) => ({property, value, target: "props"})),
    ...Object.entries(variant.slots ?? {}).flatMap(([property, value]) => value ? [{property, value, target: "slots"}] : []),
  ].map((entry, propertyIndex) => ({
    ...entry, id: variant.id, path: `./scenario-jsx/${scenarioIndex}-${variantIndex}-${propertyIndex}.tsx`,
  })))
}

/** JSX исходного сценария компилируется штатным Template вместе с fixture; Bun Test в браузер не импортируется. */
function generateStorybookJsxModules(scenarios: readonly StorybookGeneratedScenario[]) {
  return [...scenarios].sort((left, right) => left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0)
    .flatMap((scenario, index) => scenario.kind !== "component" ? [] : jsxEntries(scenario.variants, index).map(entry => ({
      path: entry.path,
      source: [...entry.value.imports.map(binding => binding.imported === "default"
        ? `import ${binding.local} from ${jsString(binding.path)}`
        : `import {${binding.imported}${binding.imported === binding.local ? "" : ` as ${binding.local}`}} from ${jsString(binding.path)}`),
        ...(entry.target === "slots" && entry.property !== "default" ? [
          `function ScenarioSlot() { return <slot name=${JSON.stringify(entry.property)} /> }`,
          `export function ScenarioJsx() { return <ScenarioSlot>${entry.value.source}</ScenarioSlot> }`,
        ] : [`export function ScenarioJsx() {\n  return ${entry.value.source}\n}`]), ""].join("\n"),
    })))
}

/** Совместно предоставляет исходники browser loader, payload и slot-модулей ревизии. */
const loader: StorybookPackageBuildLoader.Output = Object.freeze({
  payloadFile: STORYBOOK_REVISION_PAYLOAD_FILE,
  generateLoaderSource: generateStorybookLoaderSource,
  generateRevisionPayloadSource: generateStorybookRevisionPayloadSource,
  generateAppliedRevisionLoaderSource: generateStorybookAppliedRevisionLoaderSource,
  generateJsxModules: generateStorybookJsxModules,
})

export default loader
