import RouteAddressOwner from "@route/address"
import ReadGraph from "@package-graph/read"
import type {
  WorkbenchBreadcrumb,
  ExternalStorybookClientSnapshot,
  ExternalStorybookClientNode,
  BrowserGraph,
  BrowserNode,
  ExternalStorybookBrowserNavigationItem,
  ExternalStorybookBrowserTabItem,
  ExternalStorybookPackageTabModel,
  StorybookPackageRevisionAncestor,
} from "../contract/types"

const formatRouteAddress = RouteAddressOwner

export function tab(node: BrowserNode, kind: ExternalStorybookPackageTabModel["viewKind"], route: string, urlPath: string, label: string): ExternalStorybookBrowserTabItem {
  return Object.freeze({id: `${kind}:${node.id}`, label, route, urlPath, title: `${label} ${node.label}`, searchText: `${label} ${node.label}`})
}

export function viewUrlPath(ownerPath: string, view: "dependencies" | "contract" | "scenarios"): string {
  if (ownerPath.startsWith("/pkg-") || ownerPath.startsWith("/packages/")) {
    return `${ownerPath.replace(/\/$/u, "")}/${view}`
  }
  return formatRouteAddress({node: ownerPath.slice(1).split("/").map(decodeURIComponent).join("/"), view})
}

export function navigationItem(graph: BrowserGraph, node: BrowserNode, route: string): ExternalStorybookBrowserNavigationItem {
  const directoryName = packageDirectoryName(node)
  return Object.freeze({
    id: node.id,
    label: directoryName ?? node.label,
    route,
    urlPath: node.urlPath,
    title: node.label,
    searchText: `${directoryName ?? ""} ${node.kind === "package" ? node.label : ""} ${subtreeSearchText(graph, node)}`.trim(),
  })
}

export function packageDirectoryName(node: BrowserNode): string | null {
  if (node.kind !== "package") return null
  if ("directoryName" in node && typeof node.directoryName === "string") return node.directoryName
  if ("packageJsonPath" in node && typeof node.packageJsonPath === "string") {
    const parts = node.packageJsonPath.replaceAll("\\", "/").split("/").filter(Boolean)
    return parts.length > 1 ? parts.at(-2)! : null
  }
  return null
}

function subtreeSearchText(graph: BrowserGraph, node: BrowserNode): string {
  const terms: string[] = [...node.searchTerms]
  const visit = (parent: BrowserNode): void => {
    for (const id of parent.childIds) {
      const child = browserNode(graph, id)
      if (child.parentId !== parent.id) throw new Error(`External Storybook search subtree mismatch: ${parent.id} -> ${id}`)
      terms.push(...child.searchTerms)
      visit(child)
    }
  }
  visit(node)
  return [...new Set(terms)].join(" ")
}

export function requiredRoute(node: BrowserNode): string {
  if (node.routePath === null) throw new Error(`External Storybook browser node has no package route: ${node.id}`)
  return node.routePath
}

export function browserNode(graph: BrowserGraph, id: string): BrowserNode {
  const matches = graph.nodes.filter(node => node.id === id)
  if (matches.length !== 1) throw new Error(`Unknown or ambiguous external Storybook graph identity: ${id}`)
  return matches[0]!
}

export function resolveBrowserRoute(graph: BrowserGraph, packageId: string, routePath: string): BrowserNode {
  if (routePath !== "" && (routePath.startsWith("/") || routePath.endsWith("/") ||
    routePath.includes("//") || routePath.includes("\\") || /[?#]/u.test(routePath))) {
    throw new Error(`Malformed external Storybook route lookup: ${routePath}`)
  }
  const matches = graph.nodes.filter(node => node.packageId === packageId &&
    (node.routePath === routePath || node.dependencyRoutePath === routePath || node.contractRoutePath === routePath || node.scenariosRoutePath === routePath))
  if (matches.length !== 1) throw new Error(`Unknown or ambiguous external Storybook route: ${packageId}:${routePath}`)
  return matches[0]!
}

export function landingBreadcrumbs(
  path: readonly ExternalStorybookClientNode[],
): readonly WorkbenchBreadcrumb[] {
  if (path.length === 0 || path.some(node =>
    node.kind !== "package" && node.kind !== "directory" && node.kind !== "unavailable")) {
    throw new Error("Storybook landing breadcrumb path must contain only physical nodes")
  }
  return Object.freeze(path.map(node => Object.freeze({
    id: node.id,
    label: node.label,
    route: "",
    urlPath: ReadGraph.browsePath(node),
    title: node.id,
  })))
}

export function packageBreadcrumbs(
  path: readonly ExternalStorybookClientNode[],
  revisionAncestors: readonly StorybookPackageRevisionAncestor[],
): readonly WorkbenchBreadcrumb[] {
  const packageIndex = path.findLastIndex(node => node.kind === "package")
  if (packageIndex < 0) {
    throw new Error(`Storybook breadcrumb path has no package root: ${path.at(-1)?.id ?? "unknown"}`)
  }
  const graphAncestors = path.slice(0, packageIndex)
  if (graphAncestors.some(node => node.kind !== "package" && node.kind !== "directory" && node.kind !== "unavailable")) {
    throw new Error("Storybook package breadcrumb ancestors must be physical nodes")
  }
  if (revisionAncestors.length > 0 && graphAncestors.length > 0 &&
    JSON.stringify(revisionAncestors.map(({id}) => id)) !== JSON.stringify(graphAncestors.map(({id}) => id))) {
    throw new Error("Storybook package breadcrumb ancestors differ from the browser graph")
  }
  const ancestors = revisionAncestors.length > 0
    ? revisionAncestors
    : graphAncestors.map(node => Object.freeze({
      id: node.id,
      kind: node.kind as "package" | "directory" | "unavailable",
      label: node.label,
      urlPath: node.urlPath,
    }))
  const packagePath = path.slice(packageIndex)
  if (packagePath[0]?.kind !== "package" || packagePath.some(node =>
    node.kind !== "package" && node.kind !== "directory")) {
    throw new Error(`Storybook package breadcrumb path is invalid: ${path.at(-1)?.id ?? "unknown"}`)
  }
  return Object.freeze([
    ...ancestors.map(ancestor => Object.freeze({
      id: ancestor.id,
      label: ancestor.label,
      route: "",
      urlPath: ancestor.urlPath,
      title: ancestor.id,
    })),
    ...packagePath.map(node => {
      if (node.routePath === null) {
        throw new Error(`Storybook package breadcrumb has no route: ${node.id}`)
      }
      return Object.freeze({
        id: node.id,
        label: node.label,
        route: node.routePath,
        title: node.id,
      })
    }),
  ])
}

export function graphPath(
  graph: ExternalStorybookClientSnapshot,
  selectedId: string,
): readonly ExternalStorybookClientNode[] {
  const byId = new Map(graph.nodes.map(node => [node.id, node] as const))
  const selected = byId.get(selectedId)
  if (selected === undefined) throw new Error(`Unknown Storybook breadcrumb node: ${selectedId}`)
  const reverse: ExternalStorybookClientNode[] = []
  const visited = new Set<string>()
  let current: ExternalStorybookClientNode | undefined = selected
  while (current !== undefined) {
    if (visited.has(current.id)) throw new Error(`Cyclic Storybook breadcrumb path: ${current.id}`)
    visited.add(current.id)
    reverse.push(current)
    if (current.parentId === null) break
    const parent = byId.get(current.parentId)
    if (parent === undefined || !parent.childIds.includes(current.id)) {
      throw new Error(`Broken Storybook breadcrumb parent: ${current.id}`)
    }
    current = parent
  }
  return Object.freeze(reverse.reverse())
}
