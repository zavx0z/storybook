import {formatRouteAddress} from "@storybook/route/address"

/** Browser-facing navigation and tabs derived from the physical graph. */
import {
  externalStorybookBrowsePath,
  type ExternalStorybookGraph,
  type ExternalStorybookGraphNode,
} from "../catalog/graph.ts"
import type {ExternalStorybookClientNode, ExternalStorybookClientSnapshot} from "./client-protocol.ts"

type BrowserGraph = ExternalStorybookGraph | ExternalStorybookClientSnapshot
type BrowserNode = ExternalStorybookGraphNode | ExternalStorybookClientNode

export type ExternalStorybookBrowserNavigationItem = Readonly<{
  id: string
  label: string
  route: string
  urlPath: string
  title: string
  searchText: string
  expandable?: boolean
  parentId?: string
}>

export type ExternalStorybookBrowserTabItem = Readonly<{
  id: string
  label: string
  route: string
  urlPath: string
  title: string
  searchText: string
}>

export type ExternalStorybookLandingModel = Readonly<{
  catalogItems: readonly ExternalStorybookBrowserNavigationItem[]
}>

export type ExternalStorybookLandingSelection = Readonly<{
  overviewNode: BrowserNode
}>

export type ExternalStorybookPackageTabModel = Readonly<{
  packageNode: BrowserNode
  selectedNode: BrowserNode
  viewKind: "overview" | "dependencies" | "contract" | "scenarios"
  urlPath: string
  tabs: readonly ExternalStorybookBrowserTabItem[]
  tabActiveId: string
}>

/** Projects every physical owner into the landing tree. */
export function deriveExternalStorybookLanding(graph: BrowserGraph): ExternalStorybookLandingModel {
  const items = graph.nodes
    .filter(node => node.kind === "package" || node.kind === "unavailable")
    .map(node => Object.freeze({
      ...navigationItem(graph, node, externalStorybookBrowsePath(node)),
      ...(node.parentId === null ? {} : {parentId: node.parentId}),
    }))
  return Object.freeze({catalogItems: Object.freeze(items)})
}

/** Uses the active package revision for its own directories and the common graph for placement. */
export function deriveExternalStorybookNavigationTree(
  graph: BrowserGraph,
  exactPackage?: Readonly<{packageId: string; graph: BrowserGraph}>,
): readonly ExternalStorybookBrowserNavigationItem[] {
  const graphIds = new Set(graph.nodes.map(node => node.id))
  const packageIds = exactPackage === undefined ? null : new Set(exactPackage.graph.nodes.map(node => node.id))
  const route = (node: BrowserNode): string => node.kind === "directory" ? node.routePath ?? node.urlPath : externalStorybookBrowsePath(node)
  const item = (source: BrowserGraph, node: BrowserNode, ids: ReadonlySet<string>): ExternalStorybookBrowserNavigationItem => Object.freeze({
    ...navigationItem(source, node, route(node)),
    expandable: node.childIds.some(id => ids.has(id)),
    ...(node.parentId === null ? {} : {parentId: node.parentId}),
  })
  const packageItems = exactPackage === undefined ? [] : exactPackage.graph.nodes
    .filter(node => node.packageId === exactPackage.packageId)
    .map(node => item(exactPackage.graph, node, packageIds!))
  const result: ExternalStorybookBrowserNavigationItem[] = []
  for (const node of graph.nodes) {
    if (exactPackage !== undefined && node.packageId === exactPackage.packageId) {
      if (node.kind === "package" && node.id === `package:${exactPackage.packageId}`) {
        result.push(...packageItems.map(packageItem => {
          if (packageItem.id !== node.id) return packageItem
          const {parentId: _isolatedParent, ...content} = packageItem
          const directoryName = packageDirectoryName(node) ?? node.label
          return Object.freeze({
            ...content,
            label: directoryName,
            searchText: `${directoryName} ${packageItem.title} ${packageItem.searchText}`,
            expandable: content.expandable || node.childIds.some(id => graphIds.has(id)),
            ...(node.parentId === null ? {} : {parentId: node.parentId}),
          })
        }))
      }
      continue
    }
    result.push(item(graph, node, graphIds))
  }
  return Object.freeze(result)
}

export function deriveExternalStorybookLandingSelection(graph: BrowserGraph, nodeId: string): ExternalStorybookLandingSelection {
  const selected = browserNode(graph, nodeId)
  if (selected.kind !== "package" && selected.kind !== "directory" && selected.kind !== "unavailable") {
    throw new Error(`External Storybook landing selection must be a physical node: ${nodeId}`)
  }
  return Object.freeze({overviewNode: selected})
}

/** An owner has one overview tab and only the structural views it contains. */
export function deriveExternalStorybookPackageTab(
  graph: BrowserGraph,
  packageId: string,
  routePath: string,
): ExternalStorybookPackageTabModel {
  const packageNode = browserNode(graph, `package:${packageId}`)
  if (packageNode.kind !== "package" || packageNode.packageId !== packageId) {
    throw new Error(`External Storybook package tab identity is invalid: ${packageId}`)
  }
  const selectedNode = resolveBrowserRoute(graph, packageId, routePath)
  if (selectedNode.kind !== "package" && selectedNode.kind !== "directory") {
    throw new Error(`External Storybook package route selected an invalid node: ${selectedNode.id}`)
  }
  const viewKind = selectedNode.scenariosRoutePath === routePath ? "scenarios"
    : selectedNode.contractRoutePath === routePath ? "contract"
      : selectedNode.dependencyRoutePath === routePath ? "dependencies" : "overview"
  const overview = tab(selectedNode, "overview", requiredRoute(selectedNode), selectedNode.urlPath, "Обзор")
  const tabs = Object.freeze([
    overview,
    ...(selectedNode.contractRoutePath === undefined ? [] : [tab(selectedNode, "contract", selectedNode.contractRoutePath, viewUrlPath(selectedNode.urlPath, "contract"), "Контракт")]),
    ...(selectedNode.dependencyRoutePath === undefined ? [] : [tab(selectedNode, "dependencies", selectedNode.dependencyRoutePath, viewUrlPath(selectedNode.urlPath, "dependencies"), "Зависимости")]),
    ...(selectedNode.scenariosRoutePath === undefined ? [] : [tab(selectedNode, "scenarios", selectedNode.scenariosRoutePath, viewUrlPath(selectedNode.urlPath, "scenarios"), "Сценарии")]),
  ])
  return Object.freeze({
    packageNode,
    selectedNode,
    viewKind,
    urlPath: viewKind === "overview" ? selectedNode.urlPath : viewUrlPath(selectedNode.urlPath, viewKind),
    tabs,
    tabActiveId: `${viewKind}:${selectedNode.id}`,
  })
}

function tab(node: BrowserNode, kind: ExternalStorybookPackageTabModel["viewKind"], route: string, urlPath: string, label: string): ExternalStorybookBrowserTabItem {
  return Object.freeze({id: `${kind}:${node.id}`, label, route, urlPath, title: `${label} ${node.label}`, searchText: `${label} ${node.label}`})
}

function viewUrlPath(ownerPath: string, view: "dependencies" | "contract" | "scenarios"): string {
  if (ownerPath.startsWith("/pkg-") || ownerPath.startsWith("/packages/")) {
    return `${ownerPath.replace(/\/$/u, "")}/${view}`
  }
  return formatRouteAddress({node: ownerPath.slice(1).split("/").map(decodeURIComponent).join("/"), view})
}

function navigationItem(graph: BrowserGraph, node: BrowserNode, route: string): ExternalStorybookBrowserNavigationItem {
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

function packageDirectoryName(node: BrowserNode): string | null {
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

function requiredRoute(node: BrowserNode): string {
  if (node.routePath === null) throw new Error(`External Storybook browser node has no package route: ${node.id}`)
  return node.routePath
}

function browserNode(graph: BrowserGraph, id: string): BrowserNode {
  const matches = graph.nodes.filter(node => node.id === id)
  if (matches.length !== 1) throw new Error(`Unknown or ambiguous external Storybook graph identity: ${id}`)
  return matches[0]!
}

function resolveBrowserRoute(graph: BrowserGraph, packageId: string, routePath: string): BrowserNode {
  if (routePath !== "" && (routePath.startsWith("/") || routePath.endsWith("/") ||
    routePath.includes("//") || routePath.includes("\\") || /[?#]/u.test(routePath))) {
    throw new Error(`Malformed external Storybook route lookup: ${routePath}`)
  }
  const matches = graph.nodes.filter(node => node.packageId === packageId &&
    (node.routePath === routePath || node.dependencyRoutePath === routePath || node.contractRoutePath === routePath || node.scenariosRoutePath === routePath))
  if (matches.length !== 1) throw new Error(`Unknown or ambiguous external Storybook route: ${packageId}:${routePath}`)
  return matches[0]!
}
