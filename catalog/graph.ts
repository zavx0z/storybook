import {storybookPackagePathSegment, storybookPackageUrlPath} from "@zavx0z/storybook-browser-lifecycle/contract"
/** Immutable normalized graph and derived route/search views. */

import {createHash} from "node:crypto"
import type {
  StorybookModuleReference,
  StorybookPresentationGroup,
  StorybookResource,
  StorybookAuthorStyleSheet,
  StorybookCategory,
  StorybookCatalogScope,
  StorybookCatalog,
  StorybookPackage,
  StorybookSubject,
  StorybookVariant,
  StorybookStoryPresentation,
  StorybookWidgetContributions,
  StorybookDirectory,
} from "./catalog.t.ts"
import {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
} from "./protocol.ts"

export type ExternalStorybookGraphNodeKind =
  | "unavailable"
  | "workspace"
  | "project"
  | "package"
  | "directory"
  | "category"
  | "subject"
  | "variant"

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
  resources: readonly StorybookResource[]
  authorStyleSheets: readonly StorybookAuthorStyleSheet[]
  widgetContributions: StorybookWidgetContributions | null
  presentation: StorybookStoryPresentation | null
  searchTerms: readonly string[]
  source: ExternalStorybookGraphSource
  presentationGroup: StorybookPresentationGroup | null
  subjectKind: string | null
  apiName: string | null
  packageJsonPath: string | null
  runtime: StorybookModuleReference | null
  module: StorybookModuleReference | null
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
  kind: "overview" | "variant"
  nodeId: string
}>

type NodeInput = Omit<ExternalStorybookGraphNode, "digest">

/**
 * Creates the only structural registry used by navigation, routing, search and
 * later build/MCP projections. Declaration arrays retain owner semantic order.
 */
export function createExternalStorybookGraph(
  declarations: StorybookCatalog,
): ExternalStorybookGraph {
  if (declarations.schemaVersion !== EXTERNAL_STORYBOOK_SCHEMA_VERSION) {
    throw new Error(`Unsupported resolved external Storybook schema: ${String(declarations.schemaVersion)}`)
  }
  const declarationsById = new Map<string, StorybookCatalogScope>()
  for (const declaration of declarations.scopes) {
    if (declarationsById.has(declaration.canonicalId)) {
      throw new Error(`Duplicate resolved external Storybook declaration: ${declaration.canonicalId}`)
    }
    declarationsById.set(declaration.canonicalId, declaration)
  }
  if (new Set(declarations.rootIds).size !== declarations.rootIds.length) {
    throw new Error("Duplicate external Storybook graph root identity")
  }

  const nodes: ExternalStorybookGraphNode[] = []
  const nodeIds = new Set<string>()
  const visitedDeclarations = new Set<string>()
  const packagePaths = new Map<string, string>()
  const appendNode = (input: NodeInput): ExternalStorybookGraphNode => {
    if (nodeIds.has(input.id)) throw new Error(`Duplicate external Storybook graph identity: ${input.id}`)
    if (input.packageId !== null && input.kind !== "directory" && input.routePath?.split("/")[0]?.startsWith("dir-")) {
      throw new Error(`Storybook catalog route uses the reserved directory prefix: ${input.routePath}`)
    }
    nodeIds.add(input.id)
    const node = Object.freeze({...input, digest: digest(input)})
    nodes.push(node)
    return node
  }

  const appendDeclaration = (
    canonicalId: string,
    parentId: string | null,
    ancestors: readonly string[],
  ): void => {
    if (visitedDeclarations.has(canonicalId)) {
      throw new Error(`External Storybook declaration has more than one graph parent: ${canonicalId}`)
    }
    const declaration = declarationsById.get(canonicalId)
    if (declaration === undefined) throw new Error(`Unknown resolved external Storybook declaration: ${canonicalId}`)
    if (declaration.kind !== "package" && declaration.kind !== "unavailable") {
      throw new Error(`Normalized Storybook owners must be packages: ${canonicalId}`)
    }
    if (declaration.kind === "package") {
      const path = storybookPackagePathSegment(declaration.id)
      const previous = packagePaths.get(path)
      if (previous !== undefined && previous !== declaration.id) {
        throw new Error(`Ambiguous Storybook package URL ${path}: ${previous} and ${declaration.id}`)
      }
      packagePaths.set(path, declaration.id)
    }
    visitedDeclarations.add(canonicalId)
    const structuralPath = Object.freeze([...ancestors, canonicalId])
    const childIds = [...(declaration.kind === "package"
      ? [...(declaration.packageIds ?? []), ...(declaration.catalog?.categories.map((category) => categoryNodeId(declaration.id, category.id)) ?? [])] : []),
      ...(declaration.directories ?? []).map(directory => directoryNodeId(canonicalId, directory.relativePath))]
    appendNode({
      id: canonicalId,
      kind: declaration.kind,
      ownerId: declaration.id,
      packageId: declaration.kind === "package" ? declaration.id : null,
      label: declaration.label,
      structuralPath,
      urlPath: declarationUrl(declaration),
      routePath: declaration.kind === "package" ? "" : null,
      parentId,
      childIds: Object.freeze([...childIds]),
      readmePath: declaration.readmePath,
      resources: Object.freeze([]),
      authorStyleSheets: declaration.kind === "package"
        ? declaration.authorStyleSheets
        : Object.freeze([]),
      widgetContributions: declaration.kind === "package" ? declaration.widgetContributions : null,
      presentation: null,
      searchTerms: searchTerms(declaration.id, declaration.label),
      source: Object.freeze({...declaration.source}),
      presentationGroup: null,
      subjectKind: null,
      apiName: null,
      packageJsonPath: declaration.kind === "package" ? declaration.packageJsonPath : null,
      runtime: declaration.kind === "package" ? declaration.runtime : null,
      module: null,
    })

    const appendDirectory = (directory: StorybookDirectory, parentId: string, ancestors: readonly string[]): void => {
      if (directory.relativePath.split("/").at(-1) !== directory.name || directory.relativePath.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid structural directory path")
      const id = directoryNodeId(canonicalId, directory.relativePath)
      const structuralPath = Object.freeze([...ancestors, id])
      // Encode each filesystem segment into an opaque route token, including names with ? or #.
      const routePath = directory.relativePath.split("/").map(part => `dir-${encodeURIComponent(part)}`).join("/")
      appendNode({
        id, kind: "directory", ownerId: declaration.id,
        packageId: declaration.kind === "package" ? declaration.id : null,
        label: directory.name, structuralPath, parentId,
        routePath: declaration.kind === "package" ? routePath : null,
        urlPath: declaration.kind === "package"
          ? packageRouteUrl(declaration.id, routePath, true)
          : `${declarationUrl(declaration)}${directory.relativePath.split("/").map(segment => `dir-${encodeURIComponent(segment)}`).join("/")}`,
        childIds: Object.freeze([]),
        readmePath: directory.readmePath,
        ...(directory.moduleDocumentation ? {moduleDocumentation: directory.moduleDocumentation} : {}),
        source: Object.freeze({path: directory.path, pointer: ""}),
        searchTerms: searchTerms(directory.name, directory.relativePath),
        resources: Object.freeze([]), authorStyleSheets: Object.freeze([]), widgetContributions: null,
        presentation: null, presentationGroup: null, subjectKind: null, apiName: null,
        packageJsonPath: null, runtime: null, module: null,
      })
    }
    for (const directory of declaration.directories ?? []) {
      const parentId = directory.parentRelativePath === undefined ? canonicalId : directoryNodeId(canonicalId, directory.parentRelativePath)
      const parent = nodes.find(node => node.id === parentId)
      if (parent === undefined) throw new Error(`Missing structural directory parent: ${parentId}`)
      appendDirectory(directory, parentId, parent.structuralPath)
    }

    if (declaration.kind === "unavailable") return

    for (const packageId of declaration.packageIds ?? []) appendDeclaration(packageId, canonicalId, structuralPath)
    appendPackageCatalog(declaration, structuralPath, appendNode)
  }

  for (const rootId of declarations.rootIds) appendDeclaration(rootId, null, Object.freeze([]))
  if (visitedDeclarations.size !== declarationsById.size) {
    const unreachable = [...declarationsById.keys()].filter((id) => !visitedDeclarations.has(id))
    throw new Error(`Resolved external Storybook declarations contain unreachable nodes: ${unreachable.join(", ")}`)
  }

  const structuralNodes = bindStructuralSubjects(nodes, declarations.scopes)
  const graphWithoutDigest = Object.freeze({
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    rootIds: Object.freeze([...declarations.rootIds]),
    nodes: structuralNodes,
  })
  const graph = Object.freeze({...graphWithoutDigest, digest: digest(graphWithoutDigest)})
  validateDerivedRoutes(graph)
  return graph
}

/**
Supplement structural modules with authored scenarios without duplicating their rows.
Several authored views of one module (for example Socket presets) remain its children.
*/
function bindStructuralSubjects(
  initial: readonly ExternalStorybookGraphNode[],
  scopes: readonly StorybookCatalogScope[],
): readonly ExternalStorybookGraphNode[] {
  const nodes = new Map(initial.map(node => [node.id, node]))
  const order = new Map(initial.map((node, index) => [node.id, index]))
  const removed = new Set<string>()
  for (const scope of scopes) {
    if (scope.kind !== "package" || scope.catalog === null) continue
    const bindings = new Map<string, string[]>()
    for (const category of scope.catalog.categories) {
      for (const subject of category.subjects) {
        if (subject.directory === undefined) continue
        const directory = scope.directories?.find(item => item.relativePath === subject.directory)
        if (directory?.structuralRole !== "module") {
          throw new Error(`Storybook subject directory must be an existing discovered module: ${scope.id}/${subject.directory}`)
        }
        const directoryId = directoryNodeId(scope.canonicalId, directory.relativePath)
        const ids = bindings.get(directoryId) ?? []
        ids.push(subjectNodeId(scope.id, category.id, subject.id))
        bindings.set(directoryId, ids)
      }
    }
    for (const [directoryId, subjects] of bindings) {
      const directory = nodes.get(directoryId)!
      if (subjects.length === 1) {
        removed.add(directoryId)
        order.set(subjects[0]!, order.get(directoryId)!)
      }
      for (const id of subjects) {
        const subject = nodes.get(id)!
        nodes.set(id, Object.freeze({
          ...subject,
          parentId: subjects.length === 1 ? directory.parentId : directoryId,
          ...(subjects.length === 1 ? {
            label: directory.label,
            readmePath: null,
            ...(directory.moduleDocumentation ? {moduleDocumentation: directory.moduleDocumentation} : {}),
            source: directory.source,
          } : {}),
        }))
      }
    }
    for (const category of scope.catalog.categories) {
      if (category.subjects.every(subject => subject.directory !== undefined)) {
        removed.add(categoryNodeId(scope.id, category.id))
      }
    }
  }
  const retained = [...nodes.values()].filter(node => !removed.has(node.id)).sort((left, right) => order.get(left.id)! - order.get(right.id)!)
  const byId = new Map(retained.map(node => [node.id, node]))
  const children = new Map<string, string[]>()
  for (const node of retained) if (node.parentId !== null) {
    const ids = children.get(node.parentId) ?? []
    ids.push(node.id)
    children.set(node.parentId, ids)
  }
  const pathFor = (node: ExternalStorybookGraphNode, visiting = new Set<string>()): readonly string[] => {
    if (visiting.has(node.id)) throw new Error(`Structural navigation cycle: ${node.id}`)
    visiting.add(node.id)
    if (node.parentId === null) return [node.id]
    const parent = byId.get(node.parentId)
    if (parent === undefined) throw new Error(`Missing structural parent: ${node.parentId}`)
    return [...pathFor(parent, visiting), node.id]
  }
  return Object.freeze(retained.map(node => {
    const {digest: previousDigest, ...input} = node
    const value = {...input, structuralPath: Object.freeze(pathFor(node)),
      childIds: Object.freeze(children.get(node.id) ?? [])}
    return Object.freeze({...value, digest: digest(value)})
  }))
}

/** Derives canonical package-tab routes without creating another registry. */
export function externalStorybookRoutes(
  graph: ExternalStorybookGraph,
): readonly ExternalStorybookRoute[] {
  const routes = graph.nodes.flatMap((node): ExternalStorybookRoute[] => {
    if (node.packageId === null || node.routePath === null) return []
    return [Object.freeze({
      packageId: node.packageId,
      path: node.routePath,
      urlPath: node.urlPath,
      kind: node.kind === "variant" ? "variant" : "overview",
      nodeId: node.id,
    })]
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
 * Searches normalized labels, ids, API names, tags, aliases, routes and
 * presentation-group metadata while preserving semantic graph order.
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

function appendPackageCatalog(
  declaration: StorybookPackage,
  packagePath: readonly string[],
  appendNode: (input: NodeInput) => ExternalStorybookGraphNode,
): void {
  const catalog = declaration.catalog
  if (catalog === null) return
  for (const category of catalog.categories) {
    const categoryId = categoryNodeId(declaration.id, category.id)
    const categoryPath = Object.freeze([...packagePath, categoryId])
    appendNode({
      id: categoryId,
      kind: "category",
      ownerId: declaration.id,
      packageId: declaration.id,
      label: category.label,
      structuralPath: categoryPath,
      urlPath: packageRouteUrl(declaration.id, category.route, true),
      routePath: category.route,
      parentId: declaration.canonicalId,
      childIds: Object.freeze(category.subjects.map((subject) =>
        subjectNodeId(declaration.id, category.id, subject.id))),
      readmePath: null,
      resources: Object.freeze([]),
      authorStyleSheets: Object.freeze([]),
      widgetContributions: null,
      presentation: null,
      searchTerms: searchTerms(
        category.id,
        category.label,
        category.route,
        category.kind,
        category.apiName,
        category.group?.id,
        category.group?.label,
      ),
      source: Object.freeze({...category.source}),
      presentationGroup: category.group,
      subjectKind: category.kind,
      apiName: category.apiName,
      packageJsonPath: null,
      runtime: null,
      module: null,
    })
    for (const subject of category.subjects) {
      appendSubject(declaration, category, subject, categoryPath, appendNode)
    }
  }
}

function appendSubject(
  declaration: StorybookPackage,
  category: StorybookCategory,
  subject: StorybookSubject,
  categoryPath: readonly string[],
  appendNode: (input: NodeInput) => ExternalStorybookGraphNode,
): void {
  const id = subjectNodeId(declaration.id, category.id, subject.id)
  const structuralPath = Object.freeze([...categoryPath, id])
  const route = subject.route
  appendNode({
    id,
    kind: "subject",
    ownerId: declaration.id,
    packageId: declaration.id,
    label: subject.label,
    structuralPath,
    urlPath: packageRouteUrl(declaration.id, route, true),
    routePath: route,
    parentId: categoryNodeId(declaration.id, category.id),
    childIds: Object.freeze(subject.variants.map((variant) =>
      variantNodeId(declaration.id, category.id, subject.id, variant.id))),
    readmePath: subject.readmePath,
    resources: Object.freeze([]),
    authorStyleSheets: Object.freeze([]),
    widgetContributions: null,
    presentation: subject.presentation,
    searchTerms: searchTerms(
      subject.id,
      subject.kind,
      subject.label,
      subject.apiName,
      ...subject.tags,
      ...subject.aliases,
    ),
    source: Object.freeze({...subject.source}),
    presentationGroup: null,
    subjectKind: subject.kind,
    apiName: subject.apiName,
    packageJsonPath: null,
    runtime: null,
    module: null,
  })
  for (const variant of subject.variants) {
    appendVariant(declaration, category, subject, variant, structuralPath, appendNode)
  }
}

function appendVariant(
  declaration: StorybookPackage,
  category: StorybookCategory,
  subject: StorybookSubject,
  variant: StorybookVariant,
  subjectPath: readonly string[],
  appendNode: (input: NodeInput) => ExternalStorybookGraphNode,
): void {
  const id = variantNodeId(declaration.id, category.id, subject.id, variant.id)
  appendNode({
    id,
    kind: "variant",
    ownerId: declaration.id,
    packageId: declaration.id,
    label: variant.label,
    structuralPath: Object.freeze([...subjectPath, id]),
    urlPath: packageRouteUrl(declaration.id, variant.route, false),
    routePath: variant.route,
    parentId: subjectNodeId(declaration.id, category.id, subject.id),
    childIds: Object.freeze([]),
    readmePath: null,
    resources: variant.resources,
    authorStyleSheets: Object.freeze([]),
    widgetContributions: null,
    presentation: variant.presentation,
    searchTerms: searchTerms(
      variant.id,
      variant.label,
      variant.route,
      variant.group?.id,
      variant.group?.label,
    ),
    source: Object.freeze({...variant.source}),
    presentationGroup: variant.group,
    subjectKind: null,
    apiName: null,
    packageJsonPath: null,
    runtime: null,
    module: variant.module,
  })
}

function categoryNodeId(packageId: string, categoryId: string): string {
  return `category:${packageId}/${categoryId}`
}

function subjectNodeId(packageId: string, categoryId: string, subjectId: string): string {
  return `subject:${packageId}/${categoryId}/${subjectId}`
}

function variantNodeId(
  packageId: string,
  categoryId: string,
  subjectId: string,
  variantId: string,
): string {
  return `variant:${packageId}/${categoryId}/${subjectId}/${variantId}`
}

function declarationUrl(declaration: StorybookCatalogScope): string {
  const encoded = encodeURIComponent(declaration.id)
  if (declaration.kind === "unavailable") return `/unavailable/${encoded}/`
  if (declaration.kind === "workspace") return `/workspaces/${encoded}/`
  if (declaration.kind === "project") return `/projects/${encoded}/`
  return storybookPackageUrlPath(declaration.id)
}

function directoryNodeId(scopeId: string, path: string): string {
  return `directory:${scopeId}/${path}`
}

function packageRouteUrl(packageId: string, route: string, _overview: boolean): string {
  return storybookPackageUrlPath(packageId, route)
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
