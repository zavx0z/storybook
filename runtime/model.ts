/** Pure browser-facing projections of the canonical external Storybook graph. */
import {storybookPackageUrlPath} from "@zavx0z/storybook-browser-lifecycle/contract"

import {
  externalStorybookBrowsePath,
  type ExternalStorybookGraph,
  type ExternalStorybookGraphNode,
} from "../catalog/graph.ts"
import type {
  StorybookPresentationGroup,
} from "../catalog/catalog.t.ts"
import type {
  ExternalStorybookClientNode,
  ExternalStorybookClientSnapshot,
} from "./client-protocol.ts"

type BrowserGraph = ExternalStorybookGraph | ExternalStorybookClientSnapshot
type BrowserNode = ExternalStorybookGraphNode | ExternalStorybookClientNode

export type ExternalStorybookBrowserNavigationItem = Readonly<{
  id: string
  label: string
  route: string
  urlPath: string
  title: string
  searchText: string
  group: StorybookPresentationGroup | null
  parentId?: string
}>

export type ExternalStorybookBrowserVariantItem = Readonly<{
  id: string
  label: string
  route: string
  urlPath: string
  title: string
  searchText: string
  group: StorybookPresentationGroup | null
}>

export type ExternalStorybookLandingModel = Readonly<{
  catalogItems: readonly ExternalStorybookBrowserNavigationItem[]
}>

export type ExternalStorybookLandingSelection = Readonly<{
  catalogActiveId: string
  secondaryItems: readonly ExternalStorybookBrowserNavigationItem[]
  secondaryActiveId: string | null
  overviewNode: BrowserNode
}>

export type ExternalStorybookPackageTabModel = Readonly<{
  packageNode: BrowserNode
  selectedNode: BrowserNode
  catalogItems: readonly ExternalStorybookBrowserNavigationItem[]
  catalogActiveId: string | null
  secondaryItems: readonly ExternalStorybookBrowserNavigationItem[]
  secondaryActiveId: string | null
  variants: readonly ExternalStorybookBrowserVariantItem[]
  variantActiveId: string | null
  viewKind: "overview" | "variant" | "dependencies" | "contract" | "scenarios"
  urlPath: string
  tabs: readonly ExternalStorybookBrowserVariantItem[]
  tabActiveId: string | null
}>

/**
 * Projects mixed attached roots into one landing Navigation Tree model.
 *
 * Workspace nodes become presentation groups only. Their project children are
 * selectable rows, while independently attached projects and packages remain
 * direct rows without a fabricated parent.
 */
export function deriveExternalStorybookLanding(
  graph: BrowserGraph,
): ExternalStorybookLandingModel {
  const items = graph.nodes.filter(node => node.kind === "workspace" || node.kind === "project" || node.kind === "package" || node.kind === "unavailable")
    .map(node => Object.freeze({
      ...navigationItem(graph, node, externalStorybookBrowsePath(node), null),
      ...(node.parentId === null ? {} : {parentId: node.parentId}),
    }))
  return Object.freeze({catalogItems: Object.freeze(items)})
}

/** Resolves one selectable landing row or second-panel package exactly. */
export function deriveExternalStorybookLandingSelection(
  graph: BrowserGraph,
  nodeId: string,
): ExternalStorybookLandingSelection {
  const selected = browserNode(graph, nodeId)
  if (selected.kind !== "workspace" && selected.kind !== "project" && selected.kind !== "package" && selected.kind !== "directory" && selected.kind !== "unavailable") {
    throw new Error(`External Storybook landing selection must be a repository or package: ${nodeId}`)
  }
  const scope = directoryScope(graph, selected)
  return Object.freeze({
    catalogActiveId: scope.id,
    secondaryItems: scope.kind === "package" ? deriveExternalStorybookPackageContents(graph, scope.packageId!) : directoryItems(graph, scope.id),
    secondaryActiveId: selected.kind === "directory" ? selected.id : null,
    overviewNode: selected,
  })
}

export function deriveExternalStorybookPackageContents(graph: BrowserGraph, packageId: string): readonly ExternalStorybookBrowserNavigationItem[] {
  return Object.freeze(graph.nodes.filter(node => node.packageId === packageId && (node.kind === "category" || node.kind === "subject" || node.kind === "directory"))
    .map(node => Object.freeze({
      ...navigationItem(graph, node, requiredRoute(node), node.kind === "category" ? nodeGroup(node) : null),
      ...(node.parentId === `package:${packageId}` ? {} : {parentId: node.parentId!}),
    })))
}

function directoryScope(graph: BrowserGraph, node: BrowserNode): BrowserNode {
  while (node.kind === "directory" && node.parentId !== null) node = browserNode(graph, node.parentId)
  return node
}

function directoryItems(graph: BrowserGraph, scopeId: string): readonly ExternalStorybookBrowserNavigationItem[] {
  return Object.freeze(graph.nodes.filter(node => node.kind === "directory" && directoryScope(graph, node).id === scopeId)
    .map(node => Object.freeze({
      ...navigationItem(graph, node, node.routePath ?? node.urlPath, null),
      ...(node.parentId === scopeId ? {} : {parentId: node.parentId!}),
    })))
}

/**
 * Projects one exact package route into catalog, secondary and variants regions.
 * Package/category/subject overviews remain real selected nodes; a variant is
 * selected only for its exact route.
 */
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
  const viewKind = selectedNode.scenariosRoutePath === routePath ? "scenarios" : selectedNode.contractRoutePath === routePath ? "contract" : selectedNode.dependencyRoutePath === routePath ? "dependencies" : selectedNode.kind === "variant" ? "variant" : "overview"
  assertPackageOwnership(packageNode, selectedNode)
  const categories = packageNode.childIds.map(id => browserNode(graph, id)).filter(node => node.kind === "category")
  const catalogItems = Object.freeze(categories.map((category) =>
    navigationItem(
      graph,
      category,
      requiredRoute(category),
      nodeGroup(category),
    )))

  let category: BrowserNode | null = null
  let subject: BrowserNode | null = null
  let variant: BrowserNode | null = null
  if (selectedNode.kind === "category") category = selectedNode
  else if (selectedNode.kind === "subject") {
    subject = selectedNode
    category = subjectCategory(graph, subject)
  } else if (selectedNode.kind === "variant") {
    variant = selectedNode
    subject = exactParent(graph, variant, "subject")
    category = subjectCategory(graph, subject)
  } else if (selectedNode.kind !== "package" && selectedNode.kind !== "directory") {
    throw new Error(`External Storybook package route selected an invalid node: ${selectedNode.id}`)
  }

  const secondaryItems = category === null
    ? Object.freeze([]) as readonly ExternalStorybookBrowserNavigationItem[]
    : Object.freeze(category.childIds.map(id => browserNode(graph, id)).filter(item => item.kind === "subject").map((item) =>
      navigationItem(graph, item, requiredRoute(item), null)))
  const variants = subject === null
    ? Object.freeze([]) as readonly ExternalStorybookBrowserVariantItem[]
    : Object.freeze(exactChildren(graph, subject, "variant").map((item) =>
      variantItem(graph, item)))
  const tabOwner = subject ?? selectedNode
  const dependencyTab = tabOwner.dependencyRoutePath === undefined ? [] : [Object.freeze({
    id: `dependencies:${tabOwner.id}`,
    label: "Зависимости",
    route: tabOwner.dependencyRoutePath,
    urlPath: storybookPackageUrlPath(packageId, tabOwner.dependencyRoutePath),
    title: `Зависимости ${tabOwner.label}`,
    searchText: "Зависимости Dependencies",
    group: null,
  })]

  const contractTab = tabOwner.contractRoutePath === undefined ? [] : [Object.freeze({
    id: `contract:${tabOwner.id}`,
    label: "Контракт",
    route: tabOwner.contractRoutePath,
    urlPath: storybookPackageUrlPath(packageId, tabOwner.contractRoutePath),
    title: `Контракт ${tabOwner.label}`,
    searchText: "Контракт Input Output",
    group: null,
  })]

  const scenariosTab = tabOwner.scenariosRoutePath === undefined ? [] : [Object.freeze({
    id: `scenarios:${tabOwner.id}`,
    label: "Сценарии",
    route: tabOwner.scenariosRoutePath,
    urlPath: storybookPackageUrlPath(packageId, tabOwner.scenariosRoutePath),
    title: `Сценарии ${tabOwner.label}`,
    searchText: "Сценарии Scenarios",
    group: null,
  })]

  return Object.freeze({
    packageNode,
    selectedNode,
    catalogItems,
    catalogActiveId: category?.id ?? null,
    secondaryItems,
    secondaryActiveId: selectedNode.kind === "directory" ? selectedNode.id : subject?.id ?? null,
    variants,
    variantActiveId: variant?.id ?? null,
    viewKind,
    urlPath: viewKind === "dependencies" || viewKind === "contract" || viewKind === "scenarios" ? storybookPackageUrlPath(packageId, routePath) : selectedNode.urlPath,
    tabs: Object.freeze([...dependencyTab, ...contractTab, ...scenariosTab, ...variants]),
    tabActiveId: viewKind === "scenarios" ? scenariosTab[0]!.id : viewKind === "contract" ? contractTab[0]!.id : viewKind === "dependencies" ? dependencyTab[0]!.id : variant?.id ?? null,
  })
}

function navigationItem(
  graph: BrowserGraph,
  node: BrowserNode,
  route: string,
  group: StorybookPresentationGroup | null,
): ExternalStorybookBrowserNavigationItem {
  return Object.freeze({
    id: node.id,
    label: node.label,
    route,
    urlPath: node.urlPath,
    title: node.apiName ?? node.label,
    searchText: subtreeSearchText(graph, node),
    group,
  })
}

function subjectCategory(graph: BrowserGraph, subject: BrowserNode): BrowserNode | null {
  if (subject.parentId === null) return null
  const parent = browserNode(graph, subject.parentId)
  if (!parent.childIds.includes(subject.id)) throw new Error(`Structural subject parent mismatch: ${subject.id}`)
  return parent.kind === "category" || parent.kind === "directory" ? parent : null
}

function variantItem(
  graph: BrowserGraph,
  node: BrowserNode,
): ExternalStorybookBrowserVariantItem {
  if (node.kind !== "variant") throw new Error(`External Storybook dock item is not a variant: ${node.id}`)
  return Object.freeze({
    id: node.id,
    label: node.label,
    route: requiredRoute(node),
    urlPath: node.urlPath,
    title: node.label,
    searchText: subtreeSearchText(graph, node),
    group: nodeGroup(node),
  })
}

function exactChildren<Kind extends BrowserNode["kind"]>(
  graph: BrowserGraph,
  parent: BrowserNode,
  kind: Kind,
): readonly BrowserNode[] {
  return Object.freeze(parent.childIds.map((id) => {
    const child = browserNode(graph, id)
    if (child.parentId !== parent.id || child.kind !== kind) {
      throw new Error(`External Storybook graph child mismatch: ${parent.id} -> ${id}`)
    }
    return child
  }))
}

function exactParent<Kind extends BrowserNode["kind"]>(
  graph: BrowserGraph,
  child: BrowserNode,
  kind: Kind,
): BrowserNode {
  if (child.parentId === null) throw new Error(`External Storybook graph node has no parent: ${child.id}`)
  const parent = browserNode(graph, child.parentId)
  if (parent.kind !== kind || !parent.childIds.includes(child.id)) {
    throw new Error(`External Storybook graph parent mismatch: ${child.id}`)
  }
  return parent
}

function assertPackageOwnership(
  packageNode: BrowserNode,
  node: BrowserNode,
): void {
  if (node.packageId !== packageNode.packageId) {
    throw new Error(`External Storybook route escaped package graph: ${node.id}`)
  }
  if (node.kind === "workspace" || node.kind === "project") {
    throw new Error(`External Storybook package route selected a declaration node: ${node.id}`)
  }
}

function subtreeSearchText(
  graph: BrowserGraph,
  node: BrowserNode,
): string {
  const terms: string[] = [...node.searchTerms]
  const visit = (parent: BrowserNode): void => {
    for (const id of parent.childIds) {
      const child = browserNode(graph, id)
      if (child.parentId !== parent.id) {
        throw new Error(`External Storybook search subtree mismatch: ${parent.id} -> ${id}`)
      }
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
  const matches = graph.nodes.filter((node) => node.id === id)
  if (matches.length === 0) throw new Error(`Unknown external Storybook graph identity: ${id}`)
  if (matches.length > 1) throw new Error(`Ambiguous external Storybook graph identity: ${id}`)
  return matches[0]!
}

function resolveBrowserRoute(
  graph: BrowserGraph,
  packageId: string,
  routePath: string,
): BrowserNode {
  if (routePath !== "" && (routePath.startsWith("/") || routePath.endsWith("/") ||
    routePath.includes("//") || routePath.includes("\\") || /[?#]/u.test(routePath))) {
    throw new Error(`Malformed external Storybook route lookup: ${routePath}`)
  }
  const matches = graph.nodes.filter((node) =>
    node.packageId === packageId && (node.routePath === routePath || node.dependencyRoutePath === routePath || node.contractRoutePath === routePath || node.scenariosRoutePath === routePath))
  if (matches.length === 0) throw new Error(`Unknown external Storybook route: ${packageId}:${routePath}`)
  if (matches.length > 1) throw new Error(`Ambiguous external Storybook route: ${packageId}:${routePath}`)
  return matches[0]!
}

function nodeGroup(node: BrowserNode): StorybookPresentationGroup | null {
  return "group" in node ? node.group : node.presentationGroup
}
