/** Единый граф пакетов и реальных публичных директорий. */
import {createHash} from "node:crypto"
import {dirname, relative} from "node:path"
import {formatRouteAddress} from "@storybook/route/address"
import type {
  StorybookCatalog, StorybookCatalogScope,
} from "./catalog.t.ts"
import {EXTERNAL_STORYBOOK_SCHEMA_VERSION} from "./protocol.ts"

export type ExternalStorybookGraphNodeKind =
  | "unavailable"
  | "package"
  | "directory"

export type ExternalStorybookGraphSource = Readonly<{
  path: string
  pointer: string
}>

export type ExternalStorybookGraphNode = Readonly<{
  id: string
  kind: ExternalStorybookGraphNodeKind
  ownerId: string
  packageId: string | null
  label: string
  structuralPath: readonly string[]
  urlPath: string
  routePath: string | null
  parentId: string | null
  childIds: readonly string[]
  readmePath: string | null
  moduleDocumentation?: import("./catalog.t.ts").StorybookModuleDocumentation
  dependencySpec?: import("./catalog.t.ts").StorybookDependencySpec
  dependencyRoutePath?: string
  contractDocumentation?: import("./catalog.t.ts").StorybookContractDocumentation
  contractRoutePath?: string
  scenarioSpec?: import("./catalog.t.ts").StorybookScenarioSpec
  scenariosRoutePath?: string
  searchTerms: readonly string[]
  source: ExternalStorybookGraphSource
  packageJsonPath: string | null
  digest: string
}>

export type ExternalStorybookGraph = Readonly<{
  schemaVersion: typeof EXTERNAL_STORYBOOK_SCHEMA_VERSION
  rootIds: readonly string[]
  nodes: readonly ExternalStorybookGraphNode[]
  digest: string
}>

export type ExternalStorybookRoute = Readonly<{
  packageId: string
  path: string
  urlPath: string
  kind: "overview" | "dependencies" | "contract" | "scenarios"
  nodeId: string
}>

type NodeInput = Omit<ExternalStorybookGraphNode, "digest">

/** Строит навигацию только из package.json/workspaces и обнаруженных директорий. */
export function createExternalStorybookGraph(catalog: StorybookCatalog): ExternalStorybookGraph {
  if (catalog.schemaVersion !== EXTERNAL_STORYBOOK_SCHEMA_VERSION) throw new Error("Unsupported Storybook catalog version")
  const owners = new Map(catalog.scopes.map(scope => [scope.canonicalId, scope]))
  if (owners.size !== catalog.scopes.length) throw new Error("Duplicate Storybook package identity")
  const nodes: ExternalStorybookGraphNode[] = []
  const byId = new Map<string, ExternalStorybookGraphNode>()
  const visited = new Set<string>()
  const addresses = new Set<string>()
  const append = (input: NodeInput): void => {
    if (byId.has(input.id)) throw new Error(`Duplicate Storybook node: ${input.id}`)
    const withViews = {
      ...input,
      ...(input.dependencySpec ? {dependencyRoutePath: [input.routePath, "dependencies"].filter(Boolean).join("/")} : {}),
      ...(input.contractDocumentation ? {contractRoutePath: [input.routePath, "contract"].filter(Boolean).join("/")} : {}),
      ...(input.scenarioSpec ? {scenariosRoutePath: [input.routePath, "scenarios"].filter(Boolean).join("/")} : {}),
    }
    const node = Object.freeze({...withViews, digest: digest(withViews)})
    nodes.push(node)
    byId.set(node.id, node)
  }
  const visit = (id: string, parentId: string | null, ancestors: readonly string[], root: StorybookCatalogScope): void => {
    const scope = owners.get(id)
    if (!scope || scope.kind !== "package" && scope.kind !== "unavailable") throw new Error(`Unknown structural package: ${id}`)
    if (visited.has(id)) throw new Error(`Package referenced more than once: ${id}`)
    visited.add(id)
    const rootName = root.id.split("/").at(-1)!
    const segments = [rootName, ...relative(root.scopeRoot, scope.scopeRoot).split("/").filter(Boolean)]
    if (segments.some(segment => segment === "..")) throw new Error(`Package escapes its structural root: ${id}`)
    const urlPath = scope.kind === "unavailable" ? `/unavailable/${encodeURIComponent(scope.id)}/` : formatRouteAddress({node: segments.join("/")})
    if (addresses.has(urlPath)) throw new Error(`Ambiguous Storybook package URL: ${urlPath}`)
    addresses.add(urlPath)
    const parentScope = parentId === null ? undefined : owners.get(parentId)
    const containingDirectory = parentScope === undefined ? undefined : byId.get(directoryNodeId(parentScope.canonicalId,
      relative(parentScope.scopeRoot, dirname(scope.scopeRoot)).split("\\").join("/")))
    if (containingDirectory !== undefined) {
      parentId = containingDirectory.id
      ancestors = containingDirectory.structuralPath
    }
    const structuralPath = Object.freeze([...ancestors, id])
    append({
      id, kind: scope.kind, ownerId: scope.id, packageId: scope.kind === "package" ? scope.id : null,
      label: scope.label, structuralPath, parentId, childIds: [], urlPath,
      routePath: scope.kind === "package" ? "" : null,
      readmePath: scope.readmePath,
      ...(scope.kind === "package" ? {
        ...(scope.scenarioSpec ? {scenarioSpec: scope.scenarioSpec} : {}),
        ...(scope.contractDocumentation ? {contractDocumentation: scope.contractDocumentation} : {}),
        ...(scope.dependencySpec ? {dependencySpec: scope.dependencySpec} : {}),
      } : {}),
      source: scope.source, searchTerms: searchTerms(scope.id, scope.label),
      packageJsonPath: scope.kind === "package" ? scope.packageJsonPath : null,
    })
    for (const directory of scope.directories ?? []) {
      const relativeSegments = directory.relativePath.split("/")
      if (relativeSegments.at(-1) !== directory.name || relativeSegments.some(part => !part || part === "." || part === "..")) throw new Error("Invalid structural directory path")
      const directoryId = directoryNodeId(id, directory.relativePath)
      const parent = directory.parentRelativePath === undefined ? id : directoryNodeId(id, directory.parentRelativePath)
      const parentNode = byId.get(parent)
      if (!parentNode) throw new Error(`Missing directory parent: ${parent}`)
      append({
        id: directoryId, kind: "directory", ownerId: scope.id, packageId: scope.kind === "package" ? scope.id : null,
        label: directory.name, parentId: parent, structuralPath: [...parentNode.structuralPath, directoryId], childIds: [],
        routePath: relativeSegments.map(part => `dir-${encodeURIComponent(part)}`).join("/"),
        urlPath: formatRouteAddress({node: [...segments, ...relativeSegments].join("/")}),
        readmePath: directory.readmePath,
        ...(directory.moduleDocumentation ? {moduleDocumentation: directory.moduleDocumentation} : {}),
        ...(directory.dependencySpec ? {dependencySpec: directory.dependencySpec} : {}),
        ...(directory.contractDocumentation ? {contractDocumentation: directory.contractDocumentation} : {}),
        ...(directory.scenarioSpec ? {scenarioSpec: directory.scenarioSpec} : {}),
        source: {path: directory.path, pointer: ""}, searchTerms: searchTerms(directory.name, directory.relativePath),
        packageJsonPath: null,
      })
    }
    if (scope.kind === "package") for (const child of scope.packageIds ?? []) visit(child, id, structuralPath, root)
  }
  for (const id of catalog.rootIds) {
    const root = owners.get(id)
    if (!root) throw new Error(`Unknown Storybook root: ${id}`)
    visit(id, null, [], root)
  }
  if (visited.size !== owners.size) throw new Error("Unreachable structural packages")
  const children = new Map<string, string[]>()
  for (const node of nodes) if (node.parentId !== null) {
    const ids = children.get(node.parentId) ?? []
    ids.push(node.id)
    children.set(node.parentId, ids)
  }
  const complete = nodes.map(node => {
    const {digest: _digest, ...value} = node
    const updated = {...value, childIds: Object.freeze(children.get(node.id) ?? [])}
    return Object.freeze({...updated, digest: digest(updated)})
  })
  const value = Object.freeze({schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION, rootIds: Object.freeze([...catalog.rootIds]), nodes: Object.freeze(complete)})
  const graph = Object.freeze({...value, digest: digest(value)})
  validateDerivedRoutes(graph)
  return graph
}

function directoryNodeId(scopeId: string, path: string): string {
  return `directory:${scopeId}/${path}`
}

export function externalStorybookRoutes(
  graph: ExternalStorybookGraph,
): readonly ExternalStorybookRoute[] {
  const routes = graph.nodes.flatMap((node): ExternalStorybookRoute[] => {
    if (node.packageId === null || node.routePath === null) return []
    return [Object.freeze({
      packageId: node.packageId,
      path: node.routePath,
      urlPath: node.urlPath,
      kind: "overview",
      nodeId: node.id,
    }), ...(node.dependencyRoutePath === undefined ? [] : [Object.freeze({
      packageId: node.packageId,
      path: node.dependencyRoutePath,
      urlPath: formatRouteAddress({node: node.urlPath.slice(1).split("/").map(decodeURIComponent).join("/"), view: "dependencies"}),
      kind: "dependencies" as const,
      nodeId: node.id,
    })]), ...(node.contractRoutePath === undefined ? [] : [Object.freeze({
      packageId: node.packageId,
      path: node.contractRoutePath,
      urlPath: formatRouteAddress({node: node.urlPath.slice(1).split("/").map(decodeURIComponent).join("/"), view: "contract"}),
      kind: "contract" as const,
      nodeId: node.id,
    })]), ...(node.scenariosRoutePath === undefined ? [] : [Object.freeze({
      packageId: node.packageId,
      path: node.scenariosRoutePath,
      urlPath: formatRouteAddress({node: node.urlPath.slice(1).split("/").map(decodeURIComponent).join("/"), view: "scenarios"}),
      kind: "scenarios" as const,
      nodeId: node.id,
    })])]
  })
  return Object.freeze(routes)
}

/** Resolves an exact local package route and throws for unknown or malformed input. */
export function resolveExternalStorybookRoute(
  graph: ExternalStorybookGraph,
  packageId: string,
  path: string,
): ExternalStorybookRoute {
  const normalized = normalizeRouteLookup(path)
  const matches = externalStorybookRoutes(graph).filter((route) =>
    route.packageId === packageId && route.path === normalized)
  if (matches.length === 0) throw new Error(`Unknown external Storybook route: ${packageId}:${normalized}`)
  if (matches.length > 1) throw new Error(`Ambiguous external Storybook route: ${packageId}:${normalized}`)
  return matches[0]!
}

/** Returns one exact node and never substitutes a descendant. */
export function externalStorybookNode(
  graph: ExternalStorybookGraph,
  id: string,
): ExternalStorybookGraphNode {
  const matches = graph.nodes.filter((node) => node.id === id)
  if (matches.length === 0) throw new Error(`Unknown external Storybook graph identity: ${id}`)
  if (matches.length > 1) throw new Error(`Ambiguous external Storybook graph identity: ${id}`)
  return matches[0]!
}

/**
 * Searches normalized package and directory names while preserving graph order.
 */
export function searchExternalStorybookGraph(
  graph: ExternalStorybookGraph,
  query: string,
): readonly ExternalStorybookGraphNode[] {
  const tokens = normalizeSearch(query).split(/\s+/u).filter((token) => token.length > 0)
  if (tokens.length === 0) return graph.nodes
  return Object.freeze(graph.nodes.filter((node) => {
    const haystack = node.searchTerms.join(" ")
    return tokens.every((token) => haystack.includes(token))
  }))
}

function validateDerivedRoutes(graph: ExternalStorybookGraph): void {
  const routes = new Map<string, ExternalStorybookRoute>()
  for (const route of externalStorybookRoutes(graph)) {
    const key = `${route.packageId}\0${route.path}`
    const previous = routes.get(key)
    if (previous !== undefined) {
      throw new Error(`Duplicate normalized external Storybook route: ${route.packageId}:${route.path}`)
    }
    routes.set(key, route)
  }
}

function normalizeRouteLookup(path: string): string {
  if (path === "" || path === "/") return ""
  if (path.startsWith("/") || path.endsWith("/") || path.includes("//") ||
    path.includes("\\") || /[?#]/u.test(path) ||
    path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Malformed external Storybook route lookup: ${path}`)
  }
  return path
}

function searchTerms(...values: readonly (string | null | undefined)[]): readonly string[] {
  const terms = values
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => normalizeSearch(value).split(/\s+/u))
    .filter((value) => value.length > 0)
  return Object.freeze([...new Set(terms)])
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU")
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/** Catalog selection and package content use the canonical page URL. */
export function externalStorybookBrowsePath(node: Readonly<{kind: string; packageId: string | null; urlPath: string}>): string {
  return node.urlPath
}
