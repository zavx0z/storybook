/** Строит проверенный граф из одного нормализованного каталога Repo.

@packageDocumentation
*/
import RouteAddressOwner from "@route/address"
const formatRouteAddress = RouteAddressOwner
import {createHash} from "node:crypto"
import {dirname, relative} from "node:path"
import type {RepoDiscovery} from "@repo/discovery"
import type {GraphNode} from "./contract/graph"
import type {PackageGraphCreate} from "./contract"

export type {PackageGraphCreate} from "./contract"

type StorybookCatalogScope = RepoDiscovery.Output["scopes"][number]
type NodeInput = Omit<GraphNode, "digest">
const EXTERNAL_STORYBOOK_SCHEMA_VERSION = 1 as const

/** Строит навигацию только из package.json/workspaces и обнаруженных директорий. */
export default function createExternalStorybookGraph(catalog: PackageGraphCreate.Input): PackageGraphCreate.Output {
  if (catalog.schemaVersion !== EXTERNAL_STORYBOOK_SCHEMA_VERSION) throw new Error("Unsupported Storybook catalog version")
  const owners = new Map(catalog.scopes.map(scope => [scope.canonicalId, scope]))
  if (owners.size !== catalog.scopes.length) throw new Error("Duplicate Storybook package identity")
  const nodes: GraphNode[] = []
  const byId = new Map<string, GraphNode>()
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
      ...(scope.moduleDocumentation ? {moduleDocumentation: scope.moduleDocumentation} : {}),
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

/** Сохраняет проверку уникальности точных route keys без браузерного read-модуля. */
function validateDerivedRoutes(graph: PackageGraphCreate.Output): void {
  const routes = new Set<string>()
  for (const node of graph.nodes) {
    if (node.packageId === null || node.routePath === null) continue
    for (const path of [node.routePath, node.dependencyRoutePath, node.contractRoutePath, node.scenariosRoutePath]) {
      if (path === undefined) continue
      const key = `${node.packageId}\0${path}`
      if (routes.has(key)) throw new Error(`Duplicate normalized external Storybook route: ${node.packageId}:${path}`)
      routes.add(key)
    }
  }
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
