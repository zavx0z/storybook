import {formatRouteAddress} from "@storybook/route/address"

/** Pure browser-facing projections of the canonical external Storybook graph. */

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
  expandable?: boolean
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
  overviewNode: BrowserNode
}>

export type ExternalStorybookPackageTabModel = Readonly<{
  packageNode: BrowserNode
  selectedNode: BrowserNode
  categoryId: string | null
  subjectId: string | null
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

/**
Проецирует один навигационный путь от подключённого корня до предмета.
Ветвь открытого пакета берётся из его точной применённой ревизии.
Родитель самого пакета остаётся из общего графа: изолированная ревизия не владеет
его положением среди подключённых репозиториев и вложенных пакетов.
*/
export function deriveExternalStorybookNavigationTree(
  graph: BrowserGraph,
  exactPackage?: Readonly<{packageId: string; graph: BrowserGraph}>,
): readonly ExternalStorybookBrowserNavigationItem[] {
  const visible = (node: BrowserNode): boolean => node.kind !== "variant"
  const graphVisibleIds = new Set(graph.nodes.filter(visible).map(node => node.id))
  const packageVisibleIds = exactPackage === undefined ? null :
    new Set(exactPackage.graph.nodes.filter(visible).map(node => node.id))
  const route = (node: BrowserNode): string =>
    node.kind === "workspace" || node.kind === "project" || node.kind === "package" || node.kind === "unavailable"
      ? externalStorybookBrowsePath(node)
      : node.routePath ?? node.urlPath
  const item = (source: BrowserGraph, node: BrowserNode, ids: ReadonlySet<string>): ExternalStorybookBrowserNavigationItem => Object.freeze({
    ...navigationItem(source, node, route(node), null),
    expandable: node.childIds.some(id => ids.has(id)),
    ...(node.parentId === null ? {} : {parentId: node.parentId}),
  })
  const packageItems = exactPackage === undefined ? [] : exactPackage.graph.nodes
    .filter(node => node.packageId === exactPackage.packageId && visible(node))
    .map(node => item(exactPackage.graph, node, packageVisibleIds!))
  const result: ExternalStorybookBrowserNavigationItem[] = []
  for (const node of graph.nodes) {
    if (!visible(node)) continue
    if (exactPackage !== undefined && node.packageId === exactPackage.packageId) {
      if (node.kind === "package" && node.id === `package:${exactPackage.packageId}`) {
        result.push(...packageItems.map(packageItem => {
          if (packageItem.id !== node.id) return packageItem
          const {parentId: _isolatedParent, ...content} = packageItem
          const directoryName = packageDirectoryName(node) ?? node.label
          return Object.freeze({
            ...content,
            label: directoryName,
            title: packageItem.title,
            searchText: `${directoryName} ${packageItem.title} ${packageItem.searchText}`,
            expandable: content.expandable || node.childIds.some(id => graphVisibleIds.has(id)),
            ...(node.parentId === null ? {} : {parentId: node.parentId}),
          })
        }))
      }
      continue
    }
    result.push(item(graph, node, graphVisibleIds))
  }
  return Object.freeze(result)
}

/** Разрешает один точный обзор главной страницы из общего дерева. */
export function deriveExternalStorybookLandingSelection(
  graph: BrowserGraph,
  nodeId: string,
): ExternalStorybookLandingSelection {
  const selected = browserNode(graph, nodeId)
  if (selected.kind !== "workspace" && selected.kind !== "project" && selected.kind !== "package" && selected.kind !== "directory" && selected.kind !== "unavailable") {
    throw new Error(`External Storybook landing selection must be a repository or package: ${nodeId}`)
  }
  return Object.freeze({overviewNode: selected})
}

/**
Проецирует точный маршрут пакета в выбранный предмет и вкладки его вариантов.
Обзоры пакета, категории и предмета остаются самостоятельными адресами.
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

  const variants = subject === null
    ? Object.freeze([]) as readonly ExternalStorybookBrowserVariantItem[]
    : Object.freeze(exactChildren(graph, subject, "variant").map((item) =>
      variantItem(graph, item)))
  const tabOwner = subject ?? selectedNode
  const dependencyTab = tabOwner.dependencyRoutePath === undefined ? [] : [Object.freeze({
    id: `dependencies:${tabOwner.id}`,
    label: "Зависимости",
    route: tabOwner.dependencyRoutePath,
    urlPath: viewUrlPath(tabOwner.urlPath, "dependencies"),
    title: `Зависимости ${tabOwner.label}`,
    searchText: "Зависимости Dependencies",
    group: null,
  })]

  const contractTab = tabOwner.contractRoutePath === undefined ? [] : [Object.freeze({
    id: `contract:${tabOwner.id}`,
    label: "Контракт",
    route: tabOwner.contractRoutePath,
    urlPath: viewUrlPath(tabOwner.urlPath, "contract"),
    title: `Контракт ${tabOwner.label}`,
    searchText: "Контракт Input Output",
    group: null,
  })]

  const scenariosTab = tabOwner.scenariosRoutePath === undefined ? [] : [Object.freeze({
    id: `scenarios:${tabOwner.id}`,
    label: "Сценарии",
    route: tabOwner.scenariosRoutePath,
    urlPath: viewUrlPath(tabOwner.urlPath, "scenarios"),
    title: `Сценарии ${tabOwner.label}`,
    searchText: "Сценарии Scenarios",
    group: null,
  })]

  return Object.freeze({
    packageNode,
    selectedNode,
    categoryId: category?.id ?? null,
    subjectId: subject?.id ?? null,
    variants,
    variantActiveId: variant?.id ?? null,
    viewKind,
    urlPath: viewKind === "dependencies" || viewKind === "contract" || viewKind === "scenarios" ? viewUrlPath(selectedNode.urlPath, viewKind) : selectedNode.urlPath,
    tabs: Object.freeze([...dependencyTab, ...contractTab, ...scenariosTab, ...variants]),
    tabActiveId: viewKind === "scenarios" ? scenariosTab[0]!.id : viewKind === "contract" ? contractTab[0]!.id : viewKind === "dependencies" ? dependencyTab[0]!.id : variant?.id ?? null,
  })
}

function viewUrlPath(ownerPath: string, view: "dependencies" | "contract" | "scenarios"): string {
  if (ownerPath.startsWith("/pkg-") || ownerPath.startsWith("/packages/")) {
    return `${ownerPath.replace(/\/$/u, "")}/${view}`
  }
  return formatRouteAddress({node: ownerPath.slice(1).split("/").map(decodeURIComponent).join("/"), view})
}

/** Отделяет имя физической папки в дереве от объявленного названия пакета. */
function navigationItem(
  graph: BrowserGraph,
  node: BrowserNode,
  route: string,
  group: StorybookPresentationGroup | null,
): ExternalStorybookBrowserNavigationItem {
  const directoryName = packageDirectoryName(node)
  return Object.freeze({
    id: node.id,
    label: directoryName ?? node.label,
    route,
    urlPath: node.urlPath,
    title: node.kind === "package" ? node.label : node.apiName ?? node.label,
    searchText: `${directoryName ?? ""} ${node.kind === "package" ? node.label : ""} ${subtreeSearchText(graph, node)}`.trim(),
    group,
  })
}

/** Совмещает browser-safe имя папки с исходным графом, который доступен только серверу. */
function packageDirectoryName(node: BrowserNode): string | null {
  if (node.kind !== "package") return null
  if ("directoryName" in node && typeof node.directoryName === "string") return node.directoryName
  if ("packageJsonPath" in node && typeof node.packageJsonPath === "string") {
    const parts = node.packageJsonPath.replaceAll("\\", "/").split("/").filter(Boolean)
    return parts.length > 1 ? parts.at(-2)! : null
  }
  return null
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
