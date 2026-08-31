/** Immutable normalized graph and derived route/search views. */

import {createHash} from "node:crypto"
import {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
  type ExternalStorybookModuleReference,
  type ExternalStorybookPresentationGroup,
  type ExternalStorybookResource,
  type ResolvedExternalStorybookAuthorStyleSheet,
  type ResolvedExternalStorybookCategory,
  type ResolvedExternalStorybookDeclaration,
  type ResolvedExternalStorybookDeclarations,
  type ResolvedExternalStorybookPackage,
  type ResolvedExternalStorybookSubject,
  type ResolvedExternalStorybookVariant,
  type ResolvedExternalStorybookStoryPresentation,
  type ResolvedExternalStorybookWidgetContributions,
} from "./declarations.ts"

export type ExternalStorybookGraphNodeKind =
  | "workspace"
  | "project"
  | "package"
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
  resources: readonly ExternalStorybookResource[]
  authorStyleSheets: readonly ResolvedExternalStorybookAuthorStyleSheet[]
  widgetContributions: ResolvedExternalStorybookWidgetContributions | null
  presentation: ResolvedExternalStorybookStoryPresentation | null
  searchTerms: readonly string[]
  source: ExternalStorybookGraphSource
  presentationGroup: ExternalStorybookPresentationGroup | null
  subjectKind: string | null
  apiName: string | null
  packageJsonPath: string | null
  runtime: ExternalStorybookModuleReference | null
  module: ExternalStorybookModuleReference | null
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
  declarations: ResolvedExternalStorybookDeclarations,
): ExternalStorybookGraph {
  if (declarations.schemaVersion !== EXTERNAL_STORYBOOK_SCHEMA_VERSION) {
    throw new Error(`Unsupported resolved external Storybook schema: ${String(declarations.schemaVersion)}`)
  }
  const declarationsById = new Map<string, ResolvedExternalStorybookDeclaration>()
  for (const declaration of declarations.declarations) {
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
  const appendNode = (input: NodeInput): ExternalStorybookGraphNode => {
    if (nodeIds.has(input.id)) throw new Error(`Duplicate external Storybook graph identity: ${input.id}`)
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
    visitedDeclarations.add(canonicalId)
    const structuralPath = Object.freeze([...ancestors, canonicalId])
    const childIds = declaration.kind === "workspace"
      ? declaration.projectIds
      : declaration.kind === "project"
        ? declaration.packageIds
        : declaration.catalog?.categories.map((category) => categoryNodeId(declaration.id, category.id)) ?? []
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
      source: Object.freeze({path: declaration.manifestPath, pointer: ""}),
      presentationGroup: null,
      subjectKind: null,
      apiName: null,
      packageJsonPath: declaration.kind === "package" ? declaration.packageJsonPath : null,
      runtime: declaration.kind === "package" ? declaration.runtime : null,
      module: null,
    })

    if (declaration.kind === "workspace") {
      for (const projectId of declaration.projectIds) {
        const project = declarationsById.get(projectId)
        if (project?.kind !== "project") {
          throw new Error(`External Storybook workspace child is not a project: ${projectId}`)
        }
        appendDeclaration(projectId, canonicalId, structuralPath)
      }
      return
    }
    if (declaration.kind === "project") {
      for (const packageId of declaration.packageIds) {
        const packageDeclaration = declarationsById.get(packageId)
        if (packageDeclaration?.kind !== "package") {
          throw new Error(`External Storybook project child is not a package: ${packageId}`)
        }
        appendDeclaration(packageId, canonicalId, structuralPath)
      }
      return
    }
    appendPackageCatalog(declaration, structuralPath, appendNode)
  }

  for (const rootId of declarations.rootIds) appendDeclaration(rootId, null, Object.freeze([]))
  if (visitedDeclarations.size !== declarationsById.size) {
    const unreachable = [...declarationsById.keys()].filter((id) => !visitedDeclarations.has(id))
    throw new Error(`Resolved external Storybook declarations contain unreachable nodes: ${unreachable.join(", ")}`)
  }

  const graphWithoutDigest = Object.freeze({
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    rootIds: Object.freeze([...declarations.rootIds]),
    nodes: Object.freeze(nodes),
  })
  const graph = Object.freeze({...graphWithoutDigest, digest: digest(graphWithoutDigest)})
  validateDerivedRoutes(graph)
  return graph
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
  declaration: ResolvedExternalStorybookPackage,
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
      source: Object.freeze({path: catalog.path, pointer: category.sourcePointer}),
      presentationGroup: category.group,
      subjectKind: category.kind,
      apiName: category.apiName,
      packageJsonPath: null,
      runtime: null,
      module: null,
    })
    for (const subject of category.subjects) {
      appendSubject(declaration, catalog.path, category, subject, categoryPath, appendNode)
    }
  }
}

function appendSubject(
  declaration: ResolvedExternalStorybookPackage,
  catalogPath: string,
  category: ResolvedExternalStorybookCategory,
  subject: ResolvedExternalStorybookSubject,
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
    source: Object.freeze({path: catalogPath, pointer: subject.sourcePointer}),
    presentationGroup: null,
    subjectKind: subject.kind,
    apiName: subject.apiName,
    packageJsonPath: null,
    runtime: null,
    module: null,
  })
  for (const variant of subject.variants) {
    appendVariant(declaration, catalogPath, category, subject, variant, structuralPath, appendNode)
  }
}

function appendVariant(
  declaration: ResolvedExternalStorybookPackage,
  catalogPath: string,
  category: ResolvedExternalStorybookCategory,
  subject: ResolvedExternalStorybookSubject,
  variant: ResolvedExternalStorybookVariant,
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
    source: Object.freeze({path: catalogPath, pointer: variant.sourcePointer}),
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

function declarationUrl(declaration: ResolvedExternalStorybookDeclaration): string {
  const encoded = encodeURIComponent(declaration.id)
  if (declaration.kind === "workspace") return `/workspaces/${encoded}/`
  if (declaration.kind === "project") return `/projects/${encoded}/`
  return `/packages/${encoded}/`
}

function packageRouteUrl(packageId: string, route: string, overview: boolean): string {
  const packageBase = `/packages/${encodeURIComponent(packageId)}`
  if (route.length === 0) return `${packageBase}/`
  const encodedRoute = route.split("/").map((segment) => encodeURIComponent(segment)).join("/")
  return `${packageBase}/${encodedRoute}${overview ? "/" : ""}`
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
