/** Browser-safe structural graph carried by one immutable package revision. */
import {externalStorybookRoutes, type ExternalStorybookGraph} from "../catalog/graph.ts"
import type {StorybookAuthorStyleSheet} from "../catalog/catalog.t.ts"
import {sha256Hex} from "../src/shared/sha256.ts"

export const STORYBOOK_PACKAGE_GRAPH_PROTOCOL = "storybook-package-graph/6" as const

export type StorybookPackageRevisionAncestor = Readonly<{
  id: string
  parentId: string | null
  kind: "package" | "directory" | "unavailable"
  label: string
  urlPath: string
}>

export type StorybookPackageRevisionGraphNode = Readonly<{
  id: string
  kind: "package" | "directory"
  ownerId: string
  packageId: string
  label: string
  parentId: string | null
  childIds: readonly string[]
  urlPath: string
  routePath: string
  searchTerms: readonly string[]
  hasModuleDocumentation?: boolean
  dependencyCases?: readonly import("../catalog/catalog.t.ts").StorybookDependencyCase[]
  dependencyRoutePath?: string
  contractRoutePath?: string
  scenariosRoutePath?: string
  contractDocuments?: readonly import("../catalog/catalog.t.ts").StorybookContractDocument[]
  resourceUrl: string
}>

export type StorybookPackageRevisionRoute = Readonly<{
  path: string
  urlPath: string
  kind: "overview" | "dependencies" | "contract" | "scenarios"
  nodeId: string
}>

export type StorybookPackageRevisionResourceLink = Readonly<{
  nodeId: string
  kind: "module-documentation"
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
    parentId: string | null
    label: string
    ownerId: string
    urlPath: string
  }>
  ancestors: readonly StorybookPackageRevisionAncestor[]
  rootId: string
  nodes: readonly StorybookPackageRevisionGraphNode[]
  routes: readonly StorybookPackageRevisionRoute[]
  resources: readonly StorybookPackageRevisionResourceLink[]
  workbenchAuthorStyleSheets: readonly StorybookPackageRevisionAuthorStyleSheet[]
}>

/** Creates the exact package projection without executable or author-declared loaders. */
export function createStorybookPackageRevisionGraphSnapshot(
  graph: ExternalStorybookGraph,
  packageId: string,
  declarationDigest: string,
  workbenchStyles: readonly StorybookAuthorStyleSheet[] = [],
): StorybookPackageRevisionGraphSnapshot {
  const sourceNodes = graph.nodes.filter(node => node.packageId === packageId)
  const packageNodes = sourceNodes.filter(node => node.kind === "package")
  if (packageNodes.length !== 1) throw new Error(`Storybook package graph must contain one package node: ${packageId}`)
  const packageNode = packageNodes[0]!
  const ancestors = Object.freeze(packageNode.structuralPath.slice(0, -1).map(id => {
    const ancestor = graph.nodes.find(node => node.id === id)
    if (ancestor === undefined || ancestor.kind !== "package" && ancestor.kind !== "directory" && ancestor.kind !== "unavailable") {
      throw new Error(`Storybook package ancestor is invalid: ${packageId}:${id}`)
    }
    return Object.freeze({
      id: ancestor.id,
      parentId: ancestor.parentId,
      kind: ancestor.kind,
      label: ancestor.label,
      urlPath: ancestor.urlPath,
    })
  }))
  const nodeIds = new Set(sourceNodes.map(({id}) => id))
  const nodes = Object.freeze(sourceNodes.map((node): StorybookPackageRevisionGraphNode => {
    if (node.kind !== "package" && node.kind !== "directory") {
      throw new Error(`Non-package node entered package graph projection: ${node.kind}`)
    }
    return Object.freeze({
      id: node.id,
      kind: node.kind,
      ownerId: node.ownerId,
      packageId,
      label: node.label,
      parentId: node.kind === "package" ? null : node.parentId,
      childIds: Object.freeze(node.childIds.filter(id => nodeIds.has(id))),
      urlPath: node.urlPath,
      routePath: requiredRoute(node.routePath, node.id),
      searchTerms: Object.freeze([...node.searchTerms]),
      ...(node.moduleDocumentation ? {hasModuleDocumentation: true} : {}),
      ...(node.dependencySpec ? {dependencyCases: node.dependencySpec.cases} : {}),
      ...(node.dependencyRoutePath === undefined ? {} : {dependencyRoutePath: node.dependencyRoutePath}),
      ...(node.contractDocumentation ? {contractDocuments: node.contractDocumentation.documents} : {}),
      ...(node.contractRoutePath === undefined ? {} : {contractRoutePath: node.contractRoutePath}),
      ...(node.scenariosRoutePath === undefined ? {} : {scenariosRoutePath: node.scenariosRoutePath}),
      resourceUrl: node.moduleDocumentation ? revisionModuleDocumentationPath(node.id) : revisionNodeResourcePrefix(node.id),
    })
  }))
  const routes = Object.freeze(externalStorybookRoutes(graph)
    .filter(route => route.packageId === packageId)
    .map((route): StorybookPackageRevisionRoute => Object.freeze({
      path: route.path,
      urlPath: route.urlPath,
      kind: route.kind,
      nodeId: route.nodeId,
    })))
  const resources = Object.freeze(sourceNodes.flatMap((node): StorybookPackageRevisionResourceLink[] => [
    ...(node.moduleDocumentation ? [Object.freeze({nodeId: node.id, kind: "module-documentation" as const, index: 0, url: revisionModuleDocumentationPath(node.id)})] : []),
  ]))
  const workbenchAuthorStyleSheets = Object.freeze(workbenchStyles.map((styleSheet, index) => Object.freeze({
    specifier: styleSheet.specifier,
    url: revisionWorkbenchAuthorStyleSheetPath(index),
    contentDigest: styleSheet.contentDigest,
  })))
  const snapshotWithoutDigest = Object.freeze({
    protocol: STORYBOOK_PACKAGE_GRAPH_PROTOCOL,
    packageId,
    declarationDigest: requiredText("declaration digest", declarationDigest),
    metadata: Object.freeze({
      parentId: packageNode.parentId,
      label: packageNode.label,
      ownerId: packageNode.ownerId,
      urlPath: packageNode.urlPath,
    }),
    ancestors,
    rootId: packageNode.id,
    nodes,
    routes,
    resources,
    workbenchAuthorStyleSheets,
  })
  return Object.freeze({...snapshotWithoutDigest, packageGraphDigest: digest(snapshotWithoutDigest)})
}

/** Rejects stale protocol shapes and broken structural links before activation. */
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
  assertKeys(value, ["protocol", "packageId", "declarationDigest", "packageGraphDigest", "metadata", "ancestors", "rootId", "nodes", "routes", "resources", "workbenchAuthorStyleSheets"], "package graph")
  const packageId = requiredText("graph packageId", value.packageId)
  if (expectedPackageId !== undefined && packageId !== expectedPackageId) {
    throw new Error(`Storybook package graph identity mismatch: ${packageId}, expected ${expectedPackageId}`)
  }
  requiredText("graph declarationDigest", value.declarationDigest)
  requiredText("graph packageGraphDigest", value.packageGraphDigest)
  if (!Array.isArray(value.ancestors) || !Array.isArray(value.nodes) || !Array.isArray(value.routes) ||
    !Array.isArray(value.resources) || !Array.isArray(value.workbenchAuthorStyleSheets)) {
    throw new TypeError(`Storybook package graph collections are invalid: ${packageId}`)
  }
  const {packageGraphDigest: _digest, ...withoutDigest} = value
  if (digest(withoutDigest) !== value.packageGraphDigest) throw new Error(`Storybook package graph digest mismatch: ${packageId}`)
  const ancestorIds = new Set<string>()
  for (const [index, ancestor] of value.ancestors.entries()) {
    if (ancestor === null || typeof ancestor !== "object" ||
      ancestor.kind !== "package" && ancestor.kind !== "directory" && ancestor.kind !== "unavailable") {
      throw new TypeError(`Storybook package ancestor ${index} is invalid: ${packageId}`)
    }
    const id = requiredText("package ancestor id", ancestor.id)
    if (ancestorIds.has(id) || ancestor.parentId !== (value.ancestors[index - 1]?.id ?? null)) {
      throw new Error(`Storybook package ancestor sequence is invalid: ${packageId}:${id}`)
    }
    ancestorIds.add(id)
    requiredText("package ancestor label", ancestor.label)
    validateUrl(ancestor.urlPath, `Storybook package ancestor URL is invalid: ${packageId}:${id}`)
  }
  if (value.metadata.parentId !== (value.ancestors.at(-1)?.id ?? null)) {
    throw new Error(`Storybook package ancestor sequence is invalid: ${packageId}`)
  }
  const nodes = new Map(value.nodes.map(node => [node.id, node] as const))
  if (nodes.size !== value.nodes.length || value.rootId !== `package:${packageId}` || nodes.get(value.rootId)?.kind !== "package") {
    throw new Error(`Storybook package root is invalid: ${packageId}`)
  }
  for (const node of value.nodes) {
    assertKeys(node, ["id", "kind", "ownerId", "packageId", "label", "parentId", "childIds", "urlPath", "routePath", "searchTerms", "hasModuleDocumentation", "dependencyCases", "dependencyRoutePath", "contractRoutePath", "scenariosRoutePath", "contractDocuments", "resourceUrl"], `package node ${node.id}`)
    if (node.kind !== "package" && node.kind !== "directory" || node.packageId !== packageId) {
      throw new Error(`Storybook package node is invalid: ${packageId}:${node.id}`)
    }
    if (node.id === value.rootId ? node.parentId !== null : node.parentId === null || !nodes.get(node.parentId)?.childIds.includes(node.id)) {
      throw new Error(`Storybook package parent is invalid: ${packageId}:${node.id}`)
    }
    for (const childId of node.childIds) {
      if (nodes.get(childId)?.parentId !== node.id) throw new Error(`Storybook package child is invalid: ${packageId}:${childId}`)
    }
    requiredRoute(node.routePath, node.id)
    validateUrl(node.urlPath, `Storybook package URL is invalid: ${packageId}:${node.id}`)
  }
  const routePaths = new Set<string>()
  for (const route of value.routes) {
    if (routePaths.has(route.path) || !nodes.has(route.nodeId) ||
      route.kind !== "overview" && route.kind !== "dependencies" && route.kind !== "contract" && route.kind !== "scenarios") {
      throw new Error(`Storybook package route is invalid: ${packageId}:${route.path}`)
    }
    routePaths.add(route.path)
  }
  for (const resource of value.resources) {
    assertKeys(resource, ["nodeId", "kind", "index", "url"], "package resource")
    const node = nodes.get(resource.nodeId)
    const valid = resource.kind === "module-documentation" && node?.hasModuleDocumentation === true
      && resource.url === revisionModuleDocumentationPath(resource.nodeId)
    if (node === undefined || resource.index !== 0 || !valid) {
      throw new Error(`Storybook package resource is invalid: ${packageId}:${resource.nodeId}`)
    }
  }
  validateWorkbenchStyleSheets(value.workbenchAuthorStyleSheets, packageId)
  return value
}

function validateWorkbenchStyleSheets(styleSheets: readonly StorybookPackageRevisionAuthorStyleSheet[], packageId: string): void {
  const specifiers = new Set<string>()
  for (const [index, styleSheet] of styleSheets.entries()) {
    const specifier = requiredText("Workbench stylesheet specifier", styleSheet?.specifier)
    if (specifiers.has(specifier) || styleSheet.url !== revisionWorkbenchAuthorStyleSheetPath(index) ||
      typeof styleSheet.contentDigest !== "string" || !/^[a-f0-9]{64}$/u.test(styleSheet.contentDigest)) {
      throw new Error(`Storybook Workbench stylesheet is invalid: ${packageId}:${specifier}`)
    }
    specifiers.add(specifier)
  }
}

function assertKeys(value: object, allowed: readonly string[], label: string): void {
  const known = new Set(allowed)
  const unexpected = Object.keys(value).find(key => !known.has(key))
  if (unexpected !== undefined) throw new Error(`Unexpected Storybook ${label} field: ${unexpected}`)
}

function requiredText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`Storybook ${label} must be non-empty text`)
  return value
}

function requiredRoute(value: string | null, nodeId: string): string {
  if (value === null) throw new Error(`Storybook package graph node has no route: ${nodeId}`)
  return value
}

function validateUrl(path: string, message: string): void {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /[?#\\]/u.test(path) ||
    new URL(path, "http://storybook.invalid").pathname !== path) throw new Error(message)
}

function digest(value: unknown): string {
  return sha256Hex(JSON.stringify(value))
}

export function revisionNodeResourcePrefix(nodeId: string): string {
  return `resources/nodes/${encodeURIComponent(nodeId)}/`
}

export function revisionModuleDocumentationPath(nodeId: string): string {
  return `${revisionNodeResourcePrefix(nodeId)}module.md`
}

export function revisionWorkbenchAuthorStyleSheetPath(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new TypeError(`Storybook Workbench stylesheet index must be a non-negative integer: ${String(index)}`)
  }
  return `workbench-author-style-sheets/${index}.css`
}
