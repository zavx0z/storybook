import {storybookPackagePathSegment} from "@zavx0z/storybook-browser-lifecycle/contract"
import {
  externalStorybookNode,
  type ExternalStorybookGraph,
  type ExternalStorybookGraphNodeKind,
} from "../catalog/graph.ts"
import type {
  StorybookPresentationGroup,
  StorybookResourceKind,
  StorybookStoryProjection,
} from "../catalog/catalog.t.ts"
import {
  STORYBOOK_STORY_PRESENTATION_PROTOCOL,
} from "../catalog/protocol.ts"
import type {
  StorybookPackageBuildState,
  StorybookPackageDiagnostic,
  StorybookPackageSessionSnapshot,
} from "../sessions/package-session.ts"

export const EXTERNAL_STORYBOOK_CLIENT_PROTOCOL = "external-storybook-client/1" as const
export const EXTERNAL_STORYBOOK_RESOURCE_PREFIX = "/__storybook/resources/nodes/" as const

export type ExternalStorybookClientStoryPresentation = Readonly<{
  protocol: typeof STORYBOOK_STORY_PRESENTATION_PROTOCOL
  projection: StorybookStoryProjection
  widgets: readonly string[]
}>

export type ExternalStorybookClientNode = Readonly<{
  id: string
  kind: ExternalStorybookGraphNodeKind
  ownerId: string
  packageId: string | null
  label: string
  parentId: string | null
  childIds: readonly string[]
  urlPath: string
  routePath: string | null
  searchTerms: readonly string[]
  group: StorybookPresentationGroup | null
  subjectKind: string | null
  apiName: string | null
  hasReadme: boolean
  hasModuleDocumentation?: boolean
  dependencyCases?: readonly import("../catalog/catalog.t.ts").StorybookDependencyCase[]
  dependencyRoutePath?: string
  resourceKinds: readonly StorybookResourceKind[]
  resourceUrl: string
  presentation: ExternalStorybookClientStoryPresentation | null
}>

export type ExternalStorybookClientDiagnostic = Readonly<{
  phase: StorybookPackageDiagnostic["phase"]
  message: string
}>

export type ExternalStorybookClientPackageSummary = Readonly<{
  packageId: string
  declarationDigest: string
  moduleGraphRevision: string | null
  candidateRevision: string | null
  builtRevision: string | null
  activatingRevision: string | null
  activeRevision: string | null
  lastWorkingRevision: string | null
  lastGoodRevision: string | null
  buildState: StorybookPackageBuildState
  diagnostics: readonly ExternalStorybookClientDiagnostic[]
}>

export type ExternalStorybookClientSnapshot = Readonly<{
  protocol: typeof EXTERNAL_STORYBOOK_CLIENT_PROTOCOL
  graphDigest: string
  rootIds: readonly string[]
  nodes: readonly ExternalStorybookClientNode[]
  packages: readonly ExternalStorybookClientPackageSummary[]
}>

/**
Projects the canonical graph and its exact PackageSession snapshots into the
serializable browser protocol. No navigation, search or build registry is
created: array order and identities remain owned by the source graph.
*/
export function createExternalStorybookClientSnapshot(
  graph: ExternalStorybookGraph,
  sessionSnapshots: readonly StorybookPackageSessionSnapshot[],
): ExternalStorybookClientSnapshot {
  if (!Array.isArray(sessionSnapshots)) {
    throw new TypeError("External Storybook client session snapshots must be a list")
  }
  validateGraphReferences(graph)
  const hiddenPaths = collectHiddenPaths(graph, sessionSnapshots)
  const sessionByPackage = new Map<string, StorybookPackageSessionSnapshot>()
  for (const snapshot of sessionSnapshots) {
    if (snapshot === null || typeof snapshot !== "object") {
      throw new TypeError("External Storybook client session snapshot must be an object")
    }
    const packageId = validatePackageId(snapshot.packageId)
    if (sessionByPackage.has(packageId)) {
      throw new Error(`Duplicate external Storybook client package session: ${packageId}`)
    }
    sessionByPackage.set(packageId, snapshot)
  }

  const packageNodes = graph.nodes.filter((node) => node.kind === "package")
  const packageIds = new Set(packageNodes.map(({packageId}) => packageId!))
  for (const packageId of sessionByPackage.keys()) {
    if (!packageIds.has(packageId)) {
      throw new Error(`Unknown external Storybook client package session: ${packageId}`)
    }
  }
  const packages = packageNodes.map((node) => {
    const packageId = node.packageId!
    const snapshot = sessionByPackage.get(packageId)
    if (snapshot === undefined) {
      throw new Error(`Missing external Storybook client package session: ${packageId}`)
    }
    return projectPackageSummary(snapshot, hiddenPaths)
  })

  const nodes = graph.nodes.map((node): ExternalStorybookClientNode => Object.freeze({
    id: node.id,
    kind: node.kind,
    ownerId: node.ownerId,
    packageId: node.packageId,
    label: node.label,
    parentId: node.parentId,
    childIds: Object.freeze([...node.childIds]),
    urlPath: node.urlPath,
    routePath: node.routePath,
    searchTerms: Object.freeze([...node.searchTerms]),
    group: node.presentationGroup === null
      ? null
      : Object.freeze({...node.presentationGroup}),
    subjectKind: node.subjectKind,
    apiName: node.apiName,
    hasReadme: node.readmePath !== null,
    ...(node.moduleDocumentation ? {hasModuleDocumentation: true} : {}),
    ...(node.dependencySpec ? {dependencyCases: node.dependencySpec.cases} : {}),
    ...(node.dependencyRoutePath === undefined ? {} : {dependencyRoutePath: node.dependencyRoutePath}),
    resourceKinds: Object.freeze([...new Set(node.resources.map(({kind}) => kind))]),
    resourceUrl: externalStorybookNodeResourceUrl(graph, node.id),
    presentation: node.presentation === null
      ? null
      : Object.freeze({
        protocol: node.presentation.protocol,
        projection: node.presentation.projection,
        widgets: Object.freeze([...node.presentation.widgets]),
      }),
  }))
  return Object.freeze({
    protocol: EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
    graphDigest: graph.digest,
    rootIds: Object.freeze([...graph.rootIds]),
    nodes: Object.freeze(nodes),
    packages: Object.freeze(packages),
  })
}

/** Encodes an exact package identity as the typed public URL segment. */
export function encodeExternalStorybookPackagePath(packageId: string): string {
  return `pkg-${storybookPackagePathSegment(validatePackageId(packageId))}`
}

/** Resolves a lossy URL slug through exact known package identities, never by guessing a scope. */
export function decodeExternalStorybookPackagePath(path: string, packageIds: readonly string[]): string {
  const matches = packageIds.filter(packageId => path === encodeExternalStorybookPackagePath(packageId))
  if (matches.length !== 1) throw new Error(`Unknown or ambiguous external Storybook package path: ${path}`)
  return matches[0]!
}

/** Returns the one resource endpoint for an exact graph node identity. */
export function externalStorybookNodeResourceUrl(
  graph: ExternalStorybookGraph,
  nodeId: string,
): string {
  const node = externalStorybookNode(graph, nodeId)
  return `${EXTERNAL_STORYBOOK_RESOURCE_PREFIX}${encodeURIComponent(node.id)}/`
}

function projectPackageSummary(
  snapshot: StorybookPackageSessionSnapshot,
  hiddenPaths: readonly string[],
): ExternalStorybookClientPackageSummary {
  const buildState = validateBuildState(snapshot.buildState)
  if (!Array.isArray(snapshot.diagnostics)) {
    throw new TypeError(`External Storybook package diagnostics must be a list: ${snapshot.packageId}`)
  }
  return Object.freeze({
    packageId: validatePackageId(snapshot.packageId),
    declarationDigest: safeRevision(snapshot.declarationDigest, "declaration digest"),
    moduleGraphRevision: optionalRevision(snapshot.moduleGraphRevision, "module graph revision"),
    candidateRevision: optionalRevision(snapshot.candidateRevision, "candidate revision"),
    builtRevision: optionalRevision(snapshot.builtRevision ?? null, "built revision"),
    activatingRevision: optionalRevision(snapshot.activatingRevision ?? null, "activating revision"),
    activeRevision: optionalRevision(snapshot.activeRevision, "active revision"),
    lastWorkingRevision: optionalRevision(snapshot.lastWorkingRevision ?? snapshot.lastGoodRevision, "last-working revision"),
    lastGoodRevision: optionalRevision(snapshot.lastGoodRevision, "last-good revision"),
    buildState,
    diagnostics: Object.freeze(snapshot.diagnostics.map((diagnostic) =>
      projectDiagnostic(diagnostic, hiddenPaths))),
  })
}

function projectDiagnostic(
  diagnostic: StorybookPackageDiagnostic,
  hiddenPaths: readonly string[],
): ExternalStorybookClientDiagnostic {
  if (diagnostic === null || typeof diagnostic !== "object") {
    throw new TypeError("External Storybook package diagnostic must be an object")
  }
  const phases = new Set<StorybookPackageDiagnostic["phase"]>([
    "resolve",
    "validate",
    "compile",
    "link",
    "protocol",
    "publish",
    "watch",
    "activation",
    "timeout",
  ])
  if (!phases.has(diagnostic.phase)) {
    throw new Error(`Unknown external Storybook diagnostic phase: ${String(diagnostic.phase)}`)
  }
  if (typeof diagnostic.message !== "string" || diagnostic.message.length === 0) {
    throw new TypeError("External Storybook package diagnostic message must be text")
  }
  let message = diagnostic.message
  for (const path of hiddenPaths) message = message.replaceAll(path, "[owner-path]")
  message = message
    .replace(/(?:file:\/\/)?\/(?:[^/\\\s:]+\/)+[^/\\\s:),;\]}]+/gu, "[owner-path]")
    .replace(/[A-Za-z]:\\(?:[^\\\s:]+\\)+[^\\\s:),;\]}]+/gu, "[owner-path]")
  return Object.freeze({phase: diagnostic.phase, message})
}

function collectHiddenPaths(
  graph: ExternalStorybookGraph,
  snapshots: readonly StorybookPackageSessionSnapshot[],
): readonly string[] {
  const paths = new Set<string>()
  for (const node of graph.nodes) {
    paths.add(node.source.path)
    if (node.readmePath !== null) paths.add(node.readmePath)
    if (node.moduleDocumentation) paths.add(node.moduleDocumentation.sourcePath)
    if (node.packageJsonPath !== null) paths.add(node.packageJsonPath)
    if (node.runtime !== null) paths.add(node.runtime.path)
    if (node.module !== null) paths.add(node.module.path)
    for (const styleSheet of node.authorStyleSheets) paths.add(styleSheet.path)
    for (const resource of node.resources) paths.add(resource.path)
  }
  for (const snapshot of snapshots) {
    if (Array.isArray(snapshot.dependencyRealpaths)) {
      for (const path of snapshot.dependencyRealpaths) paths.add(path)
    }
    if (Array.isArray(snapshot.diagnostics)) {
      for (const diagnostic of snapshot.diagnostics) {
        if (diagnostic !== null && typeof diagnostic === "object" &&
          typeof diagnostic.path === "string") paths.add(diagnostic.path)
      }
    }
  }
  return Object.freeze([...paths]
    .filter((path) => path.length > 0)
    .sort((left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0)))
}

function validateGraphReferences(graph: ExternalStorybookGraph): void {
  if (graph === null || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
    throw new TypeError("External Storybook client graph must be an object")
  }
  const nodes = new Map<string, (typeof graph.nodes)[number]>()
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) throw new Error(`Duplicate external Storybook client node: ${node.id}`)
    nodes.set(node.id, node)
  }
  for (const rootId of graph.rootIds) {
    const root = nodes.get(rootId)
    if (root === undefined || root.parentId !== null) {
      throw new Error(`Unknown external Storybook client root: ${rootId}`)
    }
  }
  for (const node of graph.nodes) {
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      throw new Error(`Unknown external Storybook client parent ${node.parentId} for ${node.id}`)
    }
    for (const childId of node.childIds) {
      const child = nodes.get(childId)
      if (child === undefined || child.parentId !== node.id) {
        throw new Error(`Unknown external Storybook client child ${childId} for ${node.id}`)
      }
    }
  }
}

function validatePackageId(value: string): string {
  if (typeof value !== "string" ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(value)) {
    throw new Error(`Invalid external Storybook package identity: ${String(value)}`)
  }
  return value
}

function validateBuildState(value: StorybookPackageBuildState): StorybookPackageBuildState {
  if (!["idle", "building", "built", "activating", "active", "ready", "failed", "disposed"].includes(value)) {
    throw new Error(`Unknown external Storybook package build state: ${String(value)}`)
  }
  return value
}

function optionalRevision(value: string | null, label: string): string | null {
  return value === null ? null : safeRevision(value, label)
}

function safeRevision(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f/\\]/u.test(value)) {
    throw new Error(`Invalid external Storybook ${label}: ${String(value)}`)
  }
  return value
}
