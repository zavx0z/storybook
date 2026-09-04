import {
  externalStorybookRoutes,
  type ExternalStorybookGraph,
  type ExternalStorybookGraphNodeKind,
} from "./graph.ts"
import type {
  ExternalStorybookStoryProjection,
  ExternalStorybookPresentationGroup,
  ExternalStorybookResourceKind,
} from "./declarations.ts"
import {
  STORYBOOK_STANDARD_WIDGET_IDS,
  STORYBOOK_STORY_PRESENTATION_PROTOCOL,
  STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL,
} from "./declarations.ts"
import {
  validateExternalStorybookExportName,
  validateExternalStorybookPackageId,
} from "./declaration-law.ts"
import {sha256Hex} from "./sha256.ts"

export const STORYBOOK_PACKAGE_GRAPH_PROTOCOL = "storybook-package-graph/2" as const

export type StorybookPackageRevisionGraphNode = Readonly<{
  id: string
  kind: Extract<ExternalStorybookGraphNodeKind, "package" | "category" | "subject" | "variant">
  ownerId: string
  packageId: string
  label: string
  parentId: string | null
  childIds: readonly string[]
  urlPath: string
  routePath: string
  searchTerms: readonly string[]
  group: ExternalStorybookPresentationGroup | null
  subjectKind: string | null
  apiName: string | null
  hasReadme: boolean
  resourceKinds: readonly ExternalStorybookResourceKind[]
  resourceUrl: string
  presentation: StorybookPackageRevisionStoryPresentation | null
}>

export type StorybookPackageRevisionStoryPresentation = Readonly<{
  protocol: typeof STORYBOOK_STORY_PRESENTATION_PROTOCOL
  projection: ExternalStorybookStoryProjection
  widgets: readonly string[]
}>

export type StorybookPackageRevisionStandardWidgetContribution = Readonly<{
  id: string
  kind: "standard"
}>

export type StorybookPackageRevisionComponentWidgetContribution = Readonly<{
  id: string
  kind: "component"
  label: string
}>

export type StorybookPackageRevisionWidgetContribution =
  | StorybookPackageRevisionStandardWidgetContribution
  | StorybookPackageRevisionComponentWidgetContribution

export type StorybookPackageRevisionWidgetContributions = Readonly<{
  protocol: typeof STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL
  items: readonly StorybookPackageRevisionWidgetContribution[]
}>

export type StorybookPackageRevisionWidgetLoader = Readonly<{
  id: string
  exportName: string
}>

export type StorybookPackageRevisionRoute = Readonly<{
  path: string
  urlPath: string
  kind: "overview" | "variant"
  nodeId: string
}>

export type StorybookPackageRevisionLoader = Readonly<{
  route: string
  nodeId: string
  exportName: string
}>

export type StorybookPackageRevisionResourceLink = Readonly<{
  nodeId: string
  kind: "readme" | ExternalStorybookResourceKind
  index: number
  url: string
}>

export type StorybookPackageRevisionAuthorStyleSheet = Readonly<{
  specifier: string
  url: string
  contentDigest: string
}>

export type StorybookPackageRevisionGraphSnapshot = Readonly<{
  protocol: typeof STORYBOOK_PACKAGE_GRAPH_PROTOCOL
  packageId: string
  declarationDigest: string
  packageGraphDigest: string
  metadata: Readonly<{
    label: string
    ownerId: string
    urlPath: string
  }>
  rootId: string
  nodes: readonly StorybookPackageRevisionGraphNode[]
  routes: readonly StorybookPackageRevisionRoute[]
  loaders: readonly StorybookPackageRevisionLoader[]
  resources: readonly StorybookPackageRevisionResourceLink[]
  authorStyleSheets: readonly StorybookPackageRevisionAuthorStyleSheet[]
  workbenchAuthorStyleSheets: readonly StorybookPackageRevisionAuthorStyleSheet[]
  widgetContributions: StorybookPackageRevisionWidgetContributions | null
  widgetLoaders: readonly StorybookPackageRevisionWidgetLoader[]
}>

/** Creates the exact browser-safe graph projection carried by one package revision. */
export function createStorybookPackageRevisionGraphSnapshot(
  graph: ExternalStorybookGraph,
  packageId: string,
  declarationDigest: string,
): StorybookPackageRevisionGraphSnapshot {
  const sourceNodes = graph.nodes.filter((node) => node.packageId === packageId)
  const packageNodes = sourceNodes.filter((node) => node.kind === "package")
  if (packageNodes.length !== 1) {
    throw new Error(`Storybook package graph must contain one package node: ${packageId}`)
  }
  const packageNode = packageNodes[0]!
  const nodeIds = new Set(sourceNodes.map(({id}) => id))
  const nodes = Object.freeze(sourceNodes.map((node): StorybookPackageRevisionGraphNode => Object.freeze({
    id: node.id,
    kind: packageNodeKind(node.kind),
    ownerId: node.ownerId,
    packageId,
    label: node.label,
    parentId: node.kind === "package" ? null : node.parentId,
    childIds: Object.freeze(node.childIds.filter((id) => nodeIds.has(id))),
    urlPath: node.urlPath,
    routePath: requiredRoute(node.routePath, node.id),
    searchTerms: Object.freeze([...node.searchTerms]),
    group: node.presentationGroup === null ? null : Object.freeze({...node.presentationGroup}),
    subjectKind: node.subjectKind,
    apiName: node.apiName,
    hasReadme: node.readmePath !== null,
    resourceKinds: Object.freeze([...new Set(node.resources.map(({kind}) => kind))]),
    resourceUrl: node.readmePath === null
      ? revisionNodeResourcePrefix(node.id)
      : revisionReadmeResourcePath(node.id),
    presentation: node.presentation === null
      ? null
      : Object.freeze({
        protocol: node.presentation.protocol,
        projection: node.presentation.projection,
        widgets: Object.freeze([...node.presentation.widgets]),
      }),
  })))
  const routes = Object.freeze(externalStorybookRoutes(graph)
    .filter((route) => route.packageId === packageId)
    .map((route): StorybookPackageRevisionRoute => Object.freeze({
      path: route.path,
      urlPath: route.urlPath,
      kind: route.kind,
      nodeId: route.nodeId,
    })))
  const loaders = Object.freeze(sourceNodes.flatMap((node): StorybookPackageRevisionLoader[] =>
    node.kind === "variant" && node.module !== null
      ? [Object.freeze({
        route: requiredRoute(node.routePath, node.id),
        nodeId: node.id,
        exportName: node.module.exportName,
      })]
      : []))
  const resources = Object.freeze(sourceNodes.flatMap((node): StorybookPackageRevisionResourceLink[] => {
    const kindIndexes = new Map<ExternalStorybookResourceKind, number>()
    return [
      ...(node.readmePath === null
        ? []
        : [Object.freeze({nodeId: node.id, kind: "readme" as const, index: 0, url: revisionReadmeResourcePath(node.id)})]),
      ...node.resources.map((resource) => {
        const index = kindIndexes.get(resource.kind) ?? 0
        kindIndexes.set(resource.kind, index + 1)
        return Object.freeze({
          nodeId: node.id,
          kind: resource.kind,
          index,
          url: revisionDeclaredResourcePath(node.id, resource.kind, index, resource.path),
        })
      }),
    ]
  }))
  const authorStyleSheets = Object.freeze(packageNode.authorStyleSheets.map((styleSheet, index) => Object.freeze({
    specifier: styleSheet.specifier,
    url: revisionAuthorStyleSheetPath(index),
    contentDigest: styleSheet.contentDigest,
  })))
  const workbenchPackageNode = graph.nodes.find((node) =>
    node.kind === "package" && node.packageId === "@zavx0z/storybook")
  const workbenchAuthorStyleSheets = Object.freeze((workbenchPackageNode?.authorStyleSheets ?? [])
    .map((styleSheet, index) => Object.freeze({
      specifier: styleSheet.specifier,
      url: revisionWorkbenchAuthorStyleSheetPath(index),
      contentDigest: styleSheet.contentDigest,
    })))
  const widgetContributions = packageNode.widgetContributions === null
    ? null
    : Object.freeze({
      protocol: packageNode.widgetContributions.protocol,
      items: Object.freeze(packageNode.widgetContributions.items.map((item) => Object.freeze(item.kind === "standard"
        ? {id: item.id, kind: item.kind}
        : {id: item.id, kind: item.kind, label: item.label}))),
    })
  const widgetLoaders = Object.freeze(packageNode.widgetContributions?.items.flatMap((item) => item.kind === "component"
    ? [Object.freeze({id: item.id, exportName: item.module.exportName})]
    : []) ?? [])
  const snapshotWithoutDigest = Object.freeze({
    protocol: STORYBOOK_PACKAGE_GRAPH_PROTOCOL,
    packageId,
    declarationDigest: requiredText("declaration digest", declarationDigest),
    metadata: Object.freeze({
      label: packageNode.label,
      ownerId: packageNode.ownerId,
      urlPath: packageNode.urlPath,
    }),
    rootId: packageNode.id,
    nodes,
    routes,
    loaders,
    resources,
    authorStyleSheets,
    workbenchAuthorStyleSheets,
    widgetContributions,
    widgetLoaders,
  })
  return Object.freeze({
    ...snapshotWithoutDigest,
    packageGraphDigest: digest(snapshotWithoutDigest),
  })
}

export function validateStorybookPackageRevisionGraphSnapshot(
  value: StorybookPackageRevisionGraphSnapshot,
  expectedPackageId?: string,
): StorybookPackageRevisionGraphSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Storybook package graph snapshot must be an object")
  }
  if (value.protocol !== STORYBOOK_PACKAGE_GRAPH_PROTOCOL) {
    throw new Error(`Unsupported Storybook package graph protocol: ${String(value.protocol)}`)
  }
  const packageId = requiredText("graph packageId", value.packageId)
  if (expectedPackageId !== undefined && packageId !== expectedPackageId) {
    throw new Error(`Storybook package graph identity mismatch: ${packageId}, expected ${expectedPackageId}`)
  }
  requiredText("graph declarationDigest", value.declarationDigest)
  requiredText("graph packageGraphDigest", value.packageGraphDigest)
  if (!Array.isArray(value.nodes) || !Array.isArray(value.routes) ||
    !Array.isArray(value.loaders) || !Array.isArray(value.resources) ||
    !Array.isArray(value.authorStyleSheets) || !Array.isArray(value.workbenchAuthorStyleSheets) ||
    !Array.isArray(value.widgetLoaders)) {
    throw new TypeError(`Storybook package graph collections are invalid: ${packageId}`)
  }
  const {packageGraphDigest: _digest, ...withoutDigest} = value
  const actual = digest(withoutDigest)
  if (actual !== value.packageGraphDigest) {
    throw new Error(`Storybook package graph digest mismatch: ${packageId}`)
  }
  const routes = new Set(value.routes.map(({path}) => path))
  if (routes.size !== value.routes.length) throw new Error(`Duplicate Storybook package graph route: ${packageId}`)
  for (const loader of value.loaders) {
    if (!routes.has(loader.route)) throw new Error(`Storybook loader has no graph route: ${packageId}:${loader.route}`)
  }
  validateRevisionAuthorStyleSheets(value.authorStyleSheets, packageId, revisionAuthorStyleSheetPath)
  validateRevisionAuthorStyleSheets(
    value.workbenchAuthorStyleSheets,
    packageId,
    revisionWorkbenchAuthorStyleSheetPath,
  )
  const contributionIds = validateRevisionWidgetContributions(value.widgetContributions, packageId)
  validateRevisionWidgetLoaders(value.widgetLoaders, value.widgetContributions, packageId)
  const nodesById = new Map(value.nodes.map((node) => [node.id, node] as const))
  for (const node of value.nodes) {
    const presentation = node.presentation
    if (node.kind === "subject" || node.kind === "variant") {
      validateRevisionStoryPresentation(presentation, contributionIds, `${packageId}:${node.id}`)
    } else if (presentation !== null) {
      throw new Error(`Storybook presentation is only valid on subject and variant nodes: ${node.id}`)
    }
    if (node.kind !== "variant") continue
    const parent = node.parentId === null ? undefined : nodesById.get(node.parentId)
    if (parent?.kind !== "subject" || JSON.stringify(parent.presentation) !== JSON.stringify(presentation)) {
      throw new Error(`Storybook variant presentation does not inherit its subject: ${node.id}`)
    }
  }
  return value
}

function validateRevisionAuthorStyleSheets(
  styleSheets: readonly StorybookPackageRevisionAuthorStyleSheet[],
  packageId: string,
  revisionPath: (index: number) => string,
): void {
  const specifiers = new Set<string>()
  for (const [index, styleSheet] of styleSheets.entries()) {
    if (styleSheet === null || typeof styleSheet !== "object") {
      throw new TypeError(`Storybook author stylesheet must be an object: ${packageId}:${index}`)
    }
    const specifier = requiredText("author stylesheet specifier", styleSheet.specifier)
    validateAuthorStyleSheetSpecifier(specifier)
    if (specifiers.has(specifier)) throw new Error(`Duplicate Storybook author stylesheet specifier: ${specifier}`)
    specifiers.add(specifier)
    if (styleSheet.url !== revisionPath(index)) {
      throw new Error(`Storybook author stylesheet URL is not canonical: ${specifier}`)
    }
    if (typeof styleSheet.contentDigest !== "string" || !/^[a-f0-9]{64}$/u.test(styleSheet.contentDigest)) {
      throw new Error(`Storybook author stylesheet content digest is invalid: ${specifier}`)
    }
  }
}

function validateRevisionWidgetContributions(
  value: StorybookPackageRevisionWidgetContributions | null,
  packageId: string,
): Set<string> {
  const available = new Set<string>(STORYBOOK_STANDARD_WIDGET_IDS)
  const reserved = new Set<string>(STORYBOOK_STANDARD_WIDGET_IDS)
  if (value === null) return available
  if (value.protocol !== STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL || !Array.isArray(value.items) || value.items.length > 32) {
    throw new Error(`Invalid Storybook widget contribution registry: ${packageId}`)
  }
  const ids = new Set<string>()
  const standardIds: string[] = []
  for (const item of value.items) {
    if (item === null || typeof item !== "object") throw new TypeError(`Storybook widget contribution must be an object: ${packageId}`)
    const id = requiredText("widget contribution id", item.id)
    if (ids.has(id)) throw new Error(`Duplicate Storybook widget contribution id: ${packageId}:${id}`)
    ids.add(id)
    if (item.kind === "standard") {
      if (packageId !== "@zavx0z/storybook" || !reserved.has(id) ||
        Object.keys(item).some((key) => key !== "id" && key !== "kind")) {
        throw new Error(`Invalid standard Storybook widget contribution: ${packageId}:${id}`)
      }
      standardIds.push(id)
    } else if (item.kind === "component") {
      if (reserved.has(id) || requiredText("widget contribution label", item.label).length === 0 ||
        Object.keys(item).some((key) => key !== "id" && key !== "kind" && key !== "label")) {
        throw new Error(`Invalid component Storybook widget contribution: ${packageId}:${id}`)
      }
      available.add(id)
    } else {
      throw new Error(`Unknown Storybook widget contribution kind: ${packageId}:${id}`)
    }
  }
  if (packageId === "@zavx0z/storybook" &&
    JSON.stringify(standardIds) !== JSON.stringify(STORYBOOK_STANDARD_WIDGET_IDS)) {
    throw new Error(`Storybook standard widget registry is incomplete or unordered: ${packageId}`)
  }
  if (packageId === "@zavx0z/storybook" && value.items.slice(0, STORYBOOK_STANDARD_WIDGET_IDS.length)
    .some((item, index) => item.kind !== "standard" || item.id !== STORYBOOK_STANDARD_WIDGET_IDS[index])) {
    throw new Error(`Storybook standard widget registry does not precede component contributions: ${packageId}`)
  }
  return available
}

function validateRevisionWidgetLoaders(
  loaders: readonly StorybookPackageRevisionWidgetLoader[],
  contributions: StorybookPackageRevisionWidgetContributions | null,
  packageId: string,
): void {
  const componentIds = contributions?.items.flatMap((item) => item.kind === "component" ? [item.id] : []) ?? []
  if (loaders.length !== componentIds.length) throw new Error(`Storybook widget loader count mismatch: ${packageId}`)
  const ids = new Set<string>()
  for (const [index, loader] of loaders.entries()) {
    if (loader === null || typeof loader !== "object") throw new TypeError(`Storybook widget loader must be an object: ${packageId}:${index}`)
    const id = requiredText("widget loader id", loader.id)
    validateExternalStorybookExportName(loader.exportName, "Storybook widget loader export")
    if (ids.has(id) || id !== componentIds[index]) throw new Error(`Storybook widget loader order mismatch: ${packageId}:${id}`)
    ids.add(id)
  }
}

function validateRevisionStoryPresentation(
  value: StorybookPackageRevisionStoryPresentation | null,
  availableWidgets: ReadonlySet<string>,
  label: string,
): void {
  if (value === null || value.protocol !== STORYBOOK_STORY_PRESENTATION_PROTOCOL ||
    (value.projection !== "display" && value.projection !== "hud" && value.projection !== "space") ||
    !Array.isArray(value.widgets) || value.widgets.length < 2 || value.widgets.length > 32) {
    throw new Error(`Invalid Storybook story presentation: ${label}`)
  }
  const widgets = new Set(value.widgets)
  if (widgets.size !== value.widgets.length || !widgets.has("source") || !widgets.has("diagnostics")) {
    throw new Error(`Invalid Storybook story presentation widgets: ${label}`)
  }
  for (const widget of widgets) {
    if (!availableWidgets.has(widget)) throw new Error(`Unknown Storybook story presentation widget: ${label}:${widget}`)
  }
}

function validateAuthorStyleSheetSpecifier(specifier: string): void {
  const segments = specifier.split("/")
  const packageName = specifier.startsWith("@")
    ? segments.length >= 3 ? `${segments[0]}/${segments[1]}` : ""
    : segments[0] ?? ""
  validateExternalStorybookPackageId(packageName, "Storybook author stylesheet package")
  const subpath = specifier.slice(packageName.length + 1)
  if (!subpath.endsWith(".css") || /[\\?#*]/u.test(subpath) ||
    subpath.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`Storybook author stylesheet specifier is invalid: ${specifier}`)
  }
}

function packageNodeKind(
  value: ExternalStorybookGraphNodeKind,
): StorybookPackageRevisionGraphNode["kind"] {
  if (value === "package" || value === "category" || value === "subject" || value === "variant") return value
  throw new Error(`Non-package node entered package graph projection: ${value}`)
}

function requiredRoute(value: string | null, nodeId: string): string {
  if (value === null) throw new Error(`Storybook package graph node has no route: ${nodeId}`)
  return value
}

export function revisionNodeResourcePrefix(nodeId: string): string {
  return `resources/nodes/${encodeURIComponent(nodeId)}/`
}

export function revisionReadmeResourcePath(nodeId: string): string {
  return `${revisionNodeResourcePrefix(nodeId)}readme.md`
}

export function revisionDeclaredResourcePath(
  nodeId: string,
  kind: ExternalStorybookResourceKind,
  index: number,
  sourcePath = "",
): string {
  const filename = sourcePath.replaceAll("\\", "/").split("/").at(-1) ?? ""
  const dot = filename.lastIndexOf(".")
  const extension = dot <= 0 ? "" : filename.slice(dot).toLowerCase()
  return `${revisionNodeResourcePrefix(nodeId)}${kind}/${index}${extension}`
}

export function revisionAuthorStyleSheetPath(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new TypeError(`Storybook author stylesheet index must be a non-negative integer: ${String(index)}`)
  }
  return `author-style-sheets/${index}.css`
}

export function revisionWorkbenchAuthorStyleSheetPath(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new TypeError(`Storybook Workbench author stylesheet index must be a non-negative integer: ${String(index)}`)
  }
  return `workbench-author-style-sheets/${index}.css`
}

function requiredText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Storybook package ${label} must be non-empty text`)
  }
  return value
}

function digest(value: unknown): string {
  return sha256Hex(JSON.stringify(value))
}
