import type {
  StorybookCatalog,
  StorybookCatalogResolver,
} from "./catalog.t.ts"
import {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
} from "./protocol.ts"
import {
  createExternalStorybookGraph,
  externalStorybookNode,
  type ExternalStorybookGraph,
} from "./graph.ts"
import type {StorybookPackageBuildDescriptor} from "../sessions/package-session.ts"
import {externalStorybookPackageDescriptors} from "../build/package-descriptor.ts"

export type ExternalStorybookAttachSource = "cli" | "workspace" | "project" | "direct-package"

export type ExternalStorybookRegistryEntry = Readonly<{
  declarationPath: string
  rootKind: "workspace" | "project" | "package" | "unavailable"
  canonicalId: string
  digest: string
  descendantIds: readonly string[]
  attachSource: ExternalStorybookAttachSource
}>

export type ExternalStorybookRegistrySnapshot = Readonly<{
  revision: number
  entries: readonly ExternalStorybookRegistryEntry[]
  catalog: StorybookCatalog
  graph: ExternalStorybookGraph
  descriptors: readonly StorybookPackageBuildDescriptor[]
}>

/**
Атомарно принимает нормализованный каталог от выбранного источника.

Источник подставляется владельцем приложения. Неуспешное обнаружение или
построение производных данных не изменяет текущие корни и граф.
*/
export class ExternalStorybookRegistry {
  #revision = 0
  #descriptors: readonly StorybookPackageBuildDescriptor[] = Object.freeze([])
  #entries: readonly ExternalStorybookRegistryEntry[] = Object.freeze([])
  #catalog: StorybookCatalog = emptyDeclarations()
  #graph: ExternalStorybookGraph = createExternalStorybookGraph(this.#catalog)

  constructor(private readonly resolveCatalog: StorybookCatalogResolver) {}

  snapshot(): ExternalStorybookRegistrySnapshot {
    return Object.freeze({
      revision: this.#revision,
      entries: this.#entries,
      catalog: this.#catalog,
      graph: this.#graph,
      descriptors: this.#descriptors,
    })
  }

  async configure(roots: readonly string[]): Promise<ExternalStorybookRegistrySnapshot> {
    return this.#resolve(roots, roots.map(() => "direct-package"))
  }

  async attach(input: string, attachSource: ExternalStorybookAttachSource = "cli"): Promise<ExternalStorybookRegistrySnapshot> {
    return this.attachMany([input], attachSource)
  }

  async attachMany(inputs: readonly string[], attachSource: ExternalStorybookAttachSource = "cli"): Promise<ExternalStorybookRegistrySnapshot> {
    if (inputs.length === 0) return this.snapshot()
    const incoming = await this.resolveCatalog([...new Set(inputs)])
    if (this.#entries.length === 0) return this.#accept(incoming, incoming.rootIds.map(() => attachSource))
    const incomingRoots = incoming.scopes.filter(scope => incoming.rootIds.includes(scope.canonicalId))
    // An explicit ancestor replaces its already selected descendants, avoiding duplicate owners.
    const incomingPaths = new Set(incoming.scopes.map(scope => scope.scopeRoot))
    const exactRoots = new Set(incomingRoots.map(scope => scope.scopeRoot))
    const kept = this.#entries.filter(entry => {
      const root = this.#catalog.scopes.find(scope => scope.canonicalId === entry.canonicalId)!.scopeRoot
      return exactRoots.has(root) || !incomingPaths.has(root)
    })
    const represented = new Set(this.#catalog.scopes.map(scope => scope.scopeRoot))
    const added = incomingRoots.filter(scope => !represented.has(scope.scopeRoot))
    return this.#resolve(
      [...kept.map(entry => entry.declarationPath), ...added.map(scope => scope.source.path)],
      [...kept.map(entry => entry.attachSource), ...added.map(() => attachSource)],
    )
  }

  async detach(scopeId: string): Promise<ExternalStorybookRegistrySnapshot> {
    const matches = this.#catalog.scopes.filter(scope => scope.canonicalId === scopeId || scope.id === scopeId)
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous attached external Storybook scope: ${scopeId}`)
    const removed = matches[0]!.canonicalId
    const scopes = new Map(this.#catalog.scopes.map(scope => [scope.canonicalId, scope]))
    const children = (id: string): readonly string[] => {
      const scope = scopes.get(id)!
      return scope.kind === "workspace" ? scope.projectIds : scope.kind === "project" || scope.kind === "package" ? scope.packageIds ?? [] : []
    }
    const contains = (id: string): boolean => id === removed || children(id).some(contains)
    const retain = (id: string): readonly string[] => id === removed ? [] :
      contains(id) ? children(id).flatMap(retain) : [scopes.get(id)!.scopeRoot]
    const paths = this.#catalog.rootIds.flatMap(retain)
    return this.#resolve(paths, paths.map(() => "direct-package"))
  }

  async refresh(): Promise<ExternalStorybookRegistrySnapshot> {
    if (this.#entries.length === 0) return this.snapshot()
    return this.#resolve(this.#entries.map(entry => entry.declarationPath), this.#entries.map(entry => entry.attachSource))
  }

  async #resolve(roots: readonly string[], sources: readonly ExternalStorybookAttachSource[]): Promise<ExternalStorybookRegistrySnapshot> {
    const raw = roots.length === 0 ? emptyDeclarations() : await this.resolveCatalog(roots, this.#catalog)
    return this.#accept(raw, sources)
  }

  #accept(raw: StorybookCatalog, sources: readonly ExternalStorybookAttachSource[]): ExternalStorybookRegistrySnapshot {
    const catalog = raw
    const graph = createExternalStorybookGraph(catalog)
    const failed = new Set(catalog.scopes.filter(scope => scope.resolutionError !== undefined).map(scope => scope.id))
    const retained = this.#descriptors.filter(descriptor => failed.has(descriptor.packageId))
    const retainedIds = new Set(retained.map(descriptor => descriptor.packageId))
    const include = new Set(catalog.scopes.filter(scope => scope.kind === "package" && !retainedIds.has(scope.id)).map(scope => scope.id))
    const descriptors = Object.freeze([...externalStorybookPackageDescriptors(catalog, graph, include), ...retained])
    const entries = createEntries(catalog, graph, sources)
    if (graph.digest === this.#graph.digest &&
      JSON.stringify(catalog.scopes.map(scope => [scope.resolutionError, scope.structurePaths])) ===
      JSON.stringify(this.#catalog.scopes.map(scope => [scope.resolutionError, scope.structurePaths]))) return this.snapshot()
    this.#descriptors = descriptors
    this.#commit(entries, catalog, graph)
    return this.snapshot()
  }

  packageDescriptors(): readonly StorybookPackageBuildDescriptor[] {
    return this.#descriptors
  }

  /** Explicitly selected roots and their declared descendants. */
  async sourceRoots(): Promise<readonly string[]> {
    if (this.#entries.length === 0) return Object.freeze([])
    const raw = this.#catalog
    return Object.freeze([...new Set(raw.scopes.map(scope => scope.scopeRoot))])
  }

  restore(snapshot: ExternalStorybookRegistrySnapshot): void {
    if (snapshot === null || typeof snapshot !== "object") {
      throw new Error("External Storybook registry rollback snapshot is invalid")
    }
    this.#revision = snapshot.revision
    this.#entries = snapshot.entries
    this.#catalog = snapshot.catalog
    this.#graph = snapshot.graph
    this.#descriptors = snapshot.descriptors
  }

  #commit(
    entries: readonly ExternalStorybookRegistryEntry[],
    catalog: StorybookCatalog,
    graph: ExternalStorybookGraph,
  ): void {
    this.#entries = Object.freeze([...entries])
    this.#catalog = catalog
    this.#graph = graph
    this.#revision += 1
  }
}

function createEntries(
  catalog: StorybookCatalog,
  graph: ExternalStorybookGraph,
  sources: readonly ExternalStorybookAttachSource[],
): readonly ExternalStorybookRegistryEntry[] {
  if (sources.length !== catalog.rootIds.length) {
    throw new Error("External Storybook attach-source count does not match roots")
  }
  return Object.freeze(catalog.rootIds.map((rootId, index) => {
    const root = catalog.scopes.find(({canonicalId}) => canonicalId === rootId)
    if (root === undefined) throw new Error(`External Storybook root declaration is missing: ${rootId}`)
    const rootNode = externalStorybookNode(graph, rootId)
    const descendantIds = graph.nodes
      .filter(({structuralPath}) => structuralPath[0] === rootId)
      .map(({id}) => id)
    return Object.freeze({
      declarationPath: root.scopeRoot,
      rootKind: root.kind,
      canonicalId: rootId,
      digest: rootNode.digest,
      descendantIds: Object.freeze(descendantIds),
      attachSource: sources[index]!,
    })
  }))
}

function emptyDeclarations(): StorybookCatalog {
  return Object.freeze({
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    rootIds: Object.freeze([]),
    scopes: Object.freeze([]),
  })
}
