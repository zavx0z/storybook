/** Pure browser-facing projections of the canonical external Storybook graph. */

import {
  type ExternalStorybookGraph,
  type ExternalStorybookGraphNode,
} from "../graph.ts"
import type {ExternalStorybookPresentationGroup} from "../declarations.ts"
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
  group: ExternalStorybookPresentationGroup | null
}>

export type ExternalStorybookBrowserVariantItem = Readonly<{
  id: string
  label: string
  route: string
  urlPath: string
  title: string
  searchText: string
  group: ExternalStorybookPresentationGroup | null
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
  const items: ExternalStorybookBrowserNavigationItem[] = []
  for (const rootId of graph.rootIds) {
    const root = exactRoot(graph, rootId)
    if (root.kind === "workspace") {
      const group = Object.freeze({id: root.id, label: root.label})
      for (const project of exactChildren(graph, root, "project")) {
        items.push(navigationItem(graph, project, project.urlPath, group))
      }
      continue
    }
    if (root.kind !== "project" && root.kind !== "package") {
      throw new Error(`External Storybook landing root is not selectable: ${root.id}`)
    }
    items.push(navigationItem(graph, root, root.urlPath, null))
  }
  return Object.freeze({catalogItems: Object.freeze(items)})
}

/** Resolves one selectable landing row or second-panel package exactly. */
export function deriveExternalStorybookLandingSelection(
  graph: BrowserGraph,
  nodeId: string,
): ExternalStorybookLandingSelection {
  const selected = browserNode(graph, nodeId)
  if (selected.kind === "workspace") {
    throw new Error(`External Storybook workspace group toggle is not a route: ${nodeId}`)
  }
  if (selected.kind === "project") {
    assertLandingProject(graph, selected)
    return Object.freeze({
      catalogActiveId: selected.id,
      secondaryItems: packageItems(graph, selected),
      secondaryActiveId: null,
      overviewNode: selected,
    })
  }
  if (selected.kind !== "package") {
    throw new Error(`External Storybook landing selection must be a project or package: ${nodeId}`)
  }
  if (selected.parentId === null) {
    if (!graph.rootIds.includes(selected.id)) {
      throw new Error(`External Storybook standalone package is not an attached root: ${selected.id}`)
    }
    return Object.freeze({
      catalogActiveId: selected.id,
      secondaryItems: Object.freeze([]),
      secondaryActiveId: null,
      overviewNode: selected,
    })
  }
  const project = browserNode(graph, selected.parentId)
  if (project.kind !== "project") {
    throw new Error(`External Storybook package parent is not a project: ${selected.id}`)
  }
  assertLandingProject(graph, project)
  if (!project.childIds.includes(selected.id)) {
    throw new Error(`External Storybook project does not own package: ${selected.id}`)
  }
  return Object.freeze({
    catalogActiveId: project.id,
    secondaryItems: packageItems(graph, project),
    secondaryActiveId: selected.id,
    overviewNode: selected,
  })
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
  assertPackageOwnership(packageNode, selectedNode)
  const categories = exactChildren(graph, packageNode, "category")
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
    category = exactParent(graph, subject, "category")
  } else if (selectedNode.kind === "variant") {
    variant = selectedNode
    subject = exactParent(graph, variant, "subject")
    category = exactParent(graph, subject, "category")
  } else if (selectedNode.kind !== "package") {
    throw new Error(`External Storybook package route selected an invalid node: ${selectedNode.id}`)
  }

  const secondaryItems = category === null
    ? Object.freeze([]) as readonly ExternalStorybookBrowserNavigationItem[]
    : Object.freeze(exactChildren(graph, category, "subject").map((item) =>
      navigationItem(graph, item, requiredRoute(item), null)))
  const variants = subject === null
    ? Object.freeze([]) as readonly ExternalStorybookBrowserVariantItem[]
    : Object.freeze(exactChildren(graph, subject, "variant").map((item) =>
      variantItem(graph, item)))

  return Object.freeze({
    packageNode,
    selectedNode,
    catalogItems,
    catalogActiveId: category?.id ?? null,
    secondaryItems,
    secondaryActiveId: subject?.id ?? null,
    variants,
    variantActiveId: variant?.id ?? null,
  })
}

function packageItems(
  graph: BrowserGraph,
  project: BrowserNode,
): readonly ExternalStorybookBrowserNavigationItem[] {
  return Object.freeze(exactChildren(graph, project, "package").map((item) =>
    navigationItem(graph, item, item.urlPath, null)))
}

function navigationItem(
  graph: BrowserGraph,
  node: BrowserNode,
  route: string,
  group: ExternalStorybookPresentationGroup | null,
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

function exactRoot(
  graph: BrowserGraph,
  id: string,
): BrowserNode {
  const node = browserNode(graph, id)
  if (node.parentId !== null) throw new Error(`External Storybook graph root has a parent: ${id}`)
  return node
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

function assertLandingProject(
  graph: BrowserGraph,
  project: BrowserNode,
): void {
  if (project.kind !== "project") throw new Error(`External Storybook landing item is not a project: ${project.id}`)
  if (project.parentId === null) {
    if (!graph.rootIds.includes(project.id)) {
      throw new Error(`External Storybook standalone project is not an attached root: ${project.id}`)
    }
    return
  }
  const workspace = browserNode(graph, project.parentId)
  if (workspace.kind !== "workspace" || !graph.rootIds.includes(workspace.id) ||
    !workspace.childIds.includes(project.id)) {
    throw new Error(`External Storybook project is not owned by an attached workspace: ${project.id}`)
  }
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
    node.packageId === packageId && node.routePath === routePath)
  if (matches.length === 0) throw new Error(`Unknown external Storybook route: ${packageId}:${routePath}`)
  if (matches.length > 1) throw new Error(`Ambiguous external Storybook route: ${packageId}:${routePath}`)
  return matches[0]!
}

function nodeGroup(node: BrowserNode): ExternalStorybookPresentationGroup | null {
  return "group" in node ? node.group : node.presentationGroup
}
