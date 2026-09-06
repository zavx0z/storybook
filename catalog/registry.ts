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
  rootKind: "workspace" | "project" | "package"
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
}>

/**
Атомарно принимает нормализованный каталог от выбранного источника.

Источник подставляется владельцем приложения. Неуспешное обнаружение или
построение производных данных не изменяет текущие корни и граф.
*/
export class ExternalStorybookRegistry {
  #revision = 0
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
    const incomingPaths = new Set(incoming.scopes.map(scope => scope.source.path))
    const exactRoots = new Set(incomingRoots.map(scope => scope.source.path))
    const kept = this.#entries.filter(entry => exactRoots.has(entry.declarationPath) || !incomingPaths.has(entry.declarationPath))
    const represented = new Set(this.#catalog.scopes.map(scope => scope.source.path))
    const added = incomingRoots.filter(scope => !represented.has(scope.source.path))
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
      return scope.kind === "workspace" ? scope.projectIds : scope.kind === "project" ? scope.packageIds : []
    }
    const contains = (id: string): boolean => id === removed || children(id).some(contains)
    const retain = (id: string): readonly string[] => id === removed ? [] :
      contains(id) ? children(id).flatMap(retain) : [scopes.get(id)!.source.path]
    const paths = this.#catalog.rootIds.flatMap(retain)
    return this.#resolve(paths, paths.map(() => "direct-package"))
  }

  async refresh(): Promise<ExternalStorybookRegistrySnapshot> {
    if (this.#entries.length === 0) return this.snapshot()
    return this.#resolve(this.#entries.map(entry => entry.declarationPath), this.#entries.map(entry => entry.attachSource))
  }

  async #resolve(roots: readonly string[], sources: readonly ExternalStorybookAttachSource[]): Promise<ExternalStorybookRegistrySnapshot> {
    const raw = roots.length === 0 ? emptyDeclarations() : await this.resolveCatalog(roots)
    return this.#accept(raw, sources)
  }

  #accept(raw: StorybookCatalog, sources: readonly ExternalStorybookAttachSource[]): ExternalStorybookRegistrySnapshot {
    const catalog = raw
    const graph = createExternalStorybookGraph(catalog)
    externalStorybookPackageDescriptors(catalog, graph)
    const entries = createEntries(catalog, graph, sources)
    if (graph.digest === this.#graph.digest) return this.snapshot()
    this.#commit(entries, catalog, graph)
    return this.snapshot()
  }

  packageDescriptors(): readonly StorybookPackageBuildDescriptor[] {
    return externalStorybookPackageDescriptors(this.#catalog, this.#graph)
  }

  /** Explicitly selected roots and their declared descendants. */
  async sourceRoots(): Promise<readonly string[]> {
    if (this.#entries.length === 0) return Object.freeze([])
    const raw = await this.resolveCatalog(this.#entries.map(entry => entry.declarationPath))
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
      declarationPath: root.source.path,
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
