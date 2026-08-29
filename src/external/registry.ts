import {createHash} from "node:crypto"
import {dirname, join, relative} from "node:path"
import {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
  resolveExternalStorybookDeclarations,
  type ResolvedExternalStorybookDeclarations,
  type ResolvedExternalStorybookPackage,
} from "./declarations.ts"
import {
  createExternalStorybookGraph,
  externalStorybookNode,
  type ExternalStorybookGraph,
} from "./graph.ts"
import type {StorybookPackageBuildDescriptor} from "./package-session.ts"
import {
  createStorybookPackageRevisionGraphSnapshot,
  revisionDeclaredResourcePath,
  revisionReadmeResourcePath,
} from "./package-revision.ts"
import {createExternalStorybookResourceAllowList} from "./resource-allowlist.ts"

export type ExternalStorybookAttachSource = "cli" | "workspace" | "project" | "direct-package"

export type ExternalStorybookRegistryEntry = Readonly<{
  declarationPath: string
  rootKind: "workspace" | "project" | "package"
  canonicalId: string
  digest: string
  descendantIds: readonly string[]
  attachSource: ExternalStorybookAttachSource
}>

export type ExternalStorybookRegistrySnapshot = Readonly<{
  revision: number
  entries: readonly ExternalStorybookRegistryEntry[]
  declarations: ResolvedExternalStorybookDeclarations
  graph: ExternalStorybookGraph
}>

/** Atomic registry of independently attached declaration roots. */
export class ExternalStorybookRegistry {
  #revision = 0
  #entries: readonly ExternalStorybookRegistryEntry[] = Object.freeze([])
  #declarations: ResolvedExternalStorybookDeclarations = emptyDeclarations()
  #graph: ExternalStorybookGraph = createExternalStorybookGraph(this.#declarations)

  snapshot(): ExternalStorybookRegistrySnapshot {
    return Object.freeze({
      revision: this.#revision,
      entries: this.#entries,
      declarations: this.#declarations,
      graph: this.#graph,
    })
  }

  async attach(
    input: string,
    attachSource: ExternalStorybookAttachSource = "cli",
  ): Promise<ExternalStorybookRegistrySnapshot> {
    const candidateInputs = [...this.#entries.map(({declarationPath}) => declarationPath), input]
    const candidateDeclarations = await resolveExternalStorybookDeclarations(candidateInputs)
    const candidateGraph = createExternalStorybookGraph(candidateDeclarations)
    externalStorybookPackageDescriptors(candidateDeclarations, candidateGraph)
    const candidateEntries = createEntries(candidateDeclarations, candidateGraph, [
      ...this.#entries.map(({attachSource: source}) => source),
      attachSource,
    ])
    this.#commit(candidateEntries, candidateDeclarations, candidateGraph)
    return this.snapshot()
  }

  async attachMany(
    inputs: readonly string[],
    attachSource: ExternalStorybookAttachSource = "cli",
  ): Promise<ExternalStorybookRegistrySnapshot> {
    if (inputs.length === 0) return this.snapshot()
    const candidateInputs = [...this.#entries.map(({declarationPath}) => declarationPath), ...inputs]
    const candidateDeclarations = await resolveExternalStorybookDeclarations(candidateInputs)
    const candidateGraph = createExternalStorybookGraph(candidateDeclarations)
    externalStorybookPackageDescriptors(candidateDeclarations, candidateGraph)
    const candidateEntries = createEntries(candidateDeclarations, candidateGraph, [
      ...this.#entries.map(({attachSource: source}) => source),
      ...inputs.map(() => attachSource),
    ])
    this.#commit(candidateEntries, candidateDeclarations, candidateGraph)
    return this.snapshot()
  }

  async detach(scopeId: string): Promise<ExternalStorybookRegistrySnapshot> {
    const matches = this.#entries.filter(({canonicalId}) =>
      canonicalId === scopeId || canonicalId.slice(canonicalId.indexOf(":") + 1) === scopeId)
    if (matches.length === 0) throw new Error(`Unknown attached external Storybook scope: ${scopeId}`)
    if (matches.length > 1) throw new Error(`Ambiguous attached external Storybook scope: ${scopeId}`)
    const removed = matches[0]!
    const remaining = this.#entries.filter((entry) => entry !== removed)
    if (remaining.length === 0) {
      this.#commit(Object.freeze([]), emptyDeclarations(), createExternalStorybookGraph(emptyDeclarations()))
      return this.snapshot()
    }
    const candidateDeclarations = await resolveExternalStorybookDeclarations(
      remaining.map(({declarationPath}) => declarationPath),
    )
    const candidateGraph = createExternalStorybookGraph(candidateDeclarations)
    externalStorybookPackageDescriptors(candidateDeclarations, candidateGraph)
    const candidateEntries = createEntries(
      candidateDeclarations,
      candidateGraph,
      remaining.map(({attachSource}) => attachSource),
    )
    this.#commit(candidateEntries, candidateDeclarations, candidateGraph)
    return this.snapshot()
  }

  async refresh(): Promise<ExternalStorybookRegistrySnapshot> {
    if (this.#entries.length === 0) return this.snapshot()
    const candidateDeclarations = await resolveExternalStorybookDeclarations(
      this.#entries.map(({declarationPath}) => declarationPath),
    )
    const candidateGraph = createExternalStorybookGraph(candidateDeclarations)
    externalStorybookPackageDescriptors(candidateDeclarations, candidateGraph)
    const candidateEntries = createEntries(
      candidateDeclarations,
      candidateGraph,
      this.#entries.map(({attachSource}) => attachSource),
    )
    this.#commit(candidateEntries, candidateDeclarations, candidateGraph)
    return this.snapshot()
  }

  packageDescriptors(): readonly StorybookPackageBuildDescriptor[] {
    return externalStorybookPackageDescriptors(this.#declarations, this.#graph)
  }

  restore(snapshot: ExternalStorybookRegistrySnapshot): void {
    if (snapshot === null || typeof snapshot !== "object") {
      throw new Error("External Storybook registry rollback snapshot is invalid")
    }
    this.#revision = snapshot.revision
    this.#entries = snapshot.entries
    this.#declarations = snapshot.declarations
    this.#graph = snapshot.graph
  }

  #commit(
    entries: readonly ExternalStorybookRegistryEntry[],
    declarations: ResolvedExternalStorybookDeclarations,
    graph: ExternalStorybookGraph,
  ): void {
    this.#entries = Object.freeze([...entries])
    this.#declarations = declarations
    this.#graph = graph
    this.#revision += 1
  }
}

/** Derives build inputs from the canonical graph instead of a second build registry. */
export function externalStorybookPackageDescriptors(
  declarations: ResolvedExternalStorybookDeclarations,
  graph: ExternalStorybookGraph,
): readonly StorybookPackageBuildDescriptor[] {
  const packages = declarations.declarations.filter(
    (declaration): declaration is ResolvedExternalStorybookPackage => declaration.kind === "package",
  )
  return Object.freeze(packages.map((declaration) => {
    const node = externalStorybookNode(graph, declaration.canonicalId)
    const projectNode = [...node.structuralPath].reverse()
      .map((id) => externalStorybookNode(graph, id))
      .find(({kind}) => kind === "project")
    const projectDeclaration = projectNode === undefined
      ? null
      : declarations.declarations.find(({canonicalId}) => canonicalId === projectNode.id)
    const projectRoot = projectDeclaration?.kind === "project"
      ? projectDeclaration.scopeRoot
      : declaration.scopeRoot
    const variants = graph.nodes.flatMap((candidate) =>
      candidate.kind === "variant" && candidate.packageId === declaration.id && candidate.module !== null
        ? [{
          route: candidate.routePath!,
          module: {path: candidate.module.path, export: candidate.module.exportName},
        }]
        : [])
    if (variants.length > 0 && declaration.runtime === null) {
      throw new Error(`Executable package has no Storybook runtime: ${declaration.id}`)
    }
    const readmeAssetsByNode = new Map(graph.nodes.flatMap((candidate) => {
      if (candidate.packageId !== declaration.id || candidate.readmePath === null) return []
      const assets = createExternalStorybookResourceAllowList({
        ownerRoot: declaration.scopeRoot,
        readmePath: candidate.readmePath,
        declaredResources: candidate.resources,
      }).entries.filter(({kind}) => kind === "readme-asset").map(({path}) => path)
      return [[candidate.id, Object.freeze(assets)] as const]
    }))
    const watchedPaths = [
      declaration.manifestPath,
      ...(declaration.catalog === null ? [] : [declaration.catalog.path]),
      ...(declaration.readmePath === null ? [] : [declaration.readmePath]),
      ...graph.nodes.flatMap((candidate) =>
        candidate.packageId === declaration.id
          ? [
            ...(candidate.readmePath === null ? [] : [candidate.readmePath]),
            ...(readmeAssetsByNode.get(candidate.id) ?? []),
            ...candidate.resources.map(({path}) => path),
          ]
          : []),
    ]
    const watchPaths = [
      {path: declaration.manifestPath, category: "declaration" as const},
      ...(declaration.catalog === null
        ? []
        : [{path: declaration.catalog.path, category: "declaration" as const}]),
      {path: declaration.packageJsonPath, category: "metadata" as const},
      {path: declaration.packageJsonPath, category: "code" as const},
      ...(declaration.readmePath === null
        ? []
        : [{path: declaration.readmePath, category: "metadata" as const}]),
      ...graph.nodes.flatMap((candidate) => candidate.packageId === declaration.id
        ? [
          ...(candidate.readmePath === null
            ? []
            : [{path: candidate.readmePath, category: "metadata" as const}]),
          ...(readmeAssetsByNode.get(candidate.id) ?? [])
            .map((path) => ({path, category: "resource" as const})),
          ...candidate.resources.map(({path}) => ({path, category: "resource" as const})),
        ]
        : []),
    ]
    const declarationDigest = packageDeclarationDigest(declaration, graph)
    const resourceFiles = graph.nodes.flatMap((candidate) => {
      if (candidate.packageId !== declaration.id) return []
      const indexes = new Map<string, number>()
      return [
        ...(candidate.readmePath === null
          ? []
          : [{sourcePath: candidate.readmePath, targetPath: revisionReadmeResourcePath(candidate.id)}]),
        ...(candidate.readmePath === null ? [] : (readmeAssetsByNode.get(candidate.id) ?? []).map((sourcePath) => ({
          sourcePath,
          targetPath: join(
            dirname(revisionReadmeResourcePath(candidate.id)),
            relative(dirname(candidate.readmePath!), sourcePath),
          ),
        }))),
        ...candidate.resources.map((resource) => {
          const index = indexes.get(resource.kind) ?? 0
          indexes.set(resource.kind, index + 1)
          return {
            sourcePath: resource.path,
            targetPath: revisionDeclaredResourcePath(candidate.id, resource.kind, index, resource.path),
          }
        }),
      ]
    })
    return Object.freeze({
      packageId: declaration.id,
      packageRoot: declaration.scopeRoot,
      projectRoot,
      manifestPath: declaration.manifestPath,
      declarationDigest,
      resourceFiles: Object.freeze(resourceFiles),
      watchPaths: Object.freeze(watchPaths),
      graphSnapshot: createStorybookPackageRevisionGraphSnapshot(
        graph,
        declaration.id,
        declarationDigest,
      ),
      runtime: declaration.runtime === null
        ? null
        : {path: declaration.runtime.path, export: declaration.runtime.exportName},
      variants: Object.freeze(variants),
      watchedPaths: Object.freeze([...new Set(watchedPaths)]),
    })
  }))
}

function createEntries(
  declarations: ResolvedExternalStorybookDeclarations,
  graph: ExternalStorybookGraph,
  sources: readonly ExternalStorybookAttachSource[],
): readonly ExternalStorybookRegistryEntry[] {
  if (sources.length !== declarations.rootIds.length) {
    throw new Error("External Storybook attach-source count does not match roots")
  }
  return Object.freeze(declarations.rootIds.map((rootId, index) => {
    const root = declarations.declarations.find(({canonicalId}) => canonicalId === rootId)
    if (root === undefined) throw new Error(`External Storybook root declaration is missing: ${rootId}`)
    const rootNode = externalStorybookNode(graph, rootId)
    const descendantIds = graph.nodes
      .filter(({structuralPath}) => structuralPath[0] === rootId)
      .map(({id}) => id)
    return Object.freeze({
      declarationPath: root.manifestPath,
      rootKind: root.kind,
      canonicalId: rootId,
      digest: rootNode.digest,
      descendantIds: Object.freeze(descendantIds),
      attachSource: sources[index]!,
    })
  }))
}

function packageDeclarationDigest(
  declaration: ResolvedExternalStorybookPackage,
  graph: ExternalStorybookGraph,
): string {
  const hash = createHash("sha256").update(`${declaration.digest}\0${declaration.catalog?.digest ?? ""}\0`)
  for (const node of graph.nodes) {
    if (node.packageId === declaration.id) hash.update(`${node.id}\0${node.digest}\0`)
  }
  return hash.digest("hex")
}

function emptyDeclarations(): ResolvedExternalStorybookDeclarations {
  return Object.freeze({
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    rootIds: Object.freeze([]),
    declarations: Object.freeze([]),
  })
}
