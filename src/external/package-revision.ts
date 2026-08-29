import {
  externalStorybookRoutes,
  type ExternalStorybookGraph,
  type ExternalStorybookGraphNodeKind,
} from "./graph.ts"
import type {
  ExternalStorybookPresentationGroup,
  ExternalStorybookResourceKind,
} from "./declarations.ts"
import {sha256Hex} from "./sha256.ts"

export const STORYBOOK_PACKAGE_GRAPH_PROTOCOL = "storybook-package-graph/1" as const

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
    !Array.isArray(value.loaders) || !Array.isArray(value.resources)) {
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
  return value
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

function requiredText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Storybook package ${label} must be non-empty text`)
  }
  return value
}

function digest(value: unknown): string {
  return sha256Hex(JSON.stringify(value))
}
