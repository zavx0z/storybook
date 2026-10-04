/** Читает маршруты, узлы и поиск готового графа без server discovery и crypto.

@packageDocumentation
*/
import RouteAddressOwner from "@storybook-package-route/address"
const formatRouteAddress = RouteAddressOwner
import type {StorybookPackageGraphRead} from "./contract"
import type {GraphRoute as ExternalStorybookRoute} from "./contract/route"

export type {StorybookPackageGraphRead} from "./contract"

type ExternalStorybookGraph = StorybookPackageGraphRead.Input
type ExternalStorybookGraphNode = ExternalStorybookGraph["nodes"][number]

function externalStorybookRoutes(
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
function resolveExternalStorybookRoute(
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
function externalStorybookNode(
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
function searchExternalStorybookGraph(
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

function normalizeRouteLookup(path: string): string {
  if (path === "" || path === "/") return ""
  if (path.startsWith("/") || path.endsWith("/") || path.includes("//") ||
    path.includes("\\") || /[?#]/u.test(path) ||
    path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Malformed external Storybook route lookup: ${path}`)
  }
  return path
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU")
}

/** Catalog selection and package content use the canonical page URL. */
function externalStorybookBrowsePath(node: Readonly<{kind: string; packageId: string | null; urlPath: string}>): string {
  return node.urlPath
}

/** Один browser-safe API чтения подготовленного графа. */
const read: StorybookPackageGraphRead.Output = Object.freeze({
  routes: externalStorybookRoutes,
  resolve: resolveExternalStorybookRoute,
  node: externalStorybookNode,
  search: searchExternalStorybookGraph,
  browsePath: externalStorybookBrowsePath,
})

export default read
