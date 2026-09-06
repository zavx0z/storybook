import {selectStorybookCatalog} from "./selection.ts"
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
  excludedScopes: readonly string[]
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
  #excludedScopes: readonly string[] = Object.freeze([])
  #entries: readonly ExternalStorybookRegistryEntry[] = Object.freeze([])
  #catalog: StorybookCatalog = emptyDeclarations()
  #graph: ExternalStorybookGraph = createExternalStorybookGraph(this.#catalog)

  constructor(private readonly resolveCatalog: StorybookCatalogResolver) {}

  snapshot(): ExternalStorybookRegistrySnapshot {
    return Object.freeze({
      revision: this.#revision,
      excludedScopes: this.#excludedScopes,
      entries: this.#entries,
      catalog: this.#catalog,
      graph: this.#graph,
    })
  }

  async configure(roots: readonly string[], excludedScopes: readonly string[] = []): Promise<ExternalStorybookRegistrySnapshot> {
    return this.#resolve(roots, roots.map(() => "direct-package"), excludedScopes)
  }

  async attach(input: string, attachSource: ExternalStorybookAttachSource = "cli"): Promise<ExternalStorybookRegistrySnapshot> {
    return this.attachMany([input], attachSource)
  }

  async attachMany(inputs: readonly string[], attachSource: ExternalStorybookAttachSource = "cli"): Promise<ExternalStorybookRegistrySnapshot> {
    if (inputs.length === 0) return this.snapshot()
    const incoming = await this.resolveCatalog([...new Set(inputs)])
    if (this.#entries.length === 0) {
      const restored = new Set(incoming.scopes.map(scope => scope.canonicalId))
      return this.#accept(incoming, incoming.rootIds.map(() => attachSource), this.#excludedScopes.filter(id => !restored.has(id)))
    }
    const currentRoots = this.#entries.map(entry => entry.declarationPath)
    const current = currentRoots.length === 0 ? emptyDeclarations() : await this.resolveCatalog(currentRoots)
    const represented = new Set(current.scopes.map(scope => scope.source.path))
    const added = incoming.rootIds.map(id => incoming.scopes.find(scope => scope.canonicalId === id)!)
      .filter(scope => !represented.has(scope.source.path))
    const restored = new Set(incoming.scopes.map(scope => scope.canonicalId))
    return this.#resolve(
      [...currentRoots, ...added.map(scope => scope.source.path)],
      [...this.#entries.map(entry => entry.attachSource), ...added.map(() => attachSource)],
      this.#excludedScopes.filter(id => !restored.has(id)),
    )
  }

  async detach(scopeId: string): Promise<ExternalStorybookRegistrySnapshot> {
    const matches = this.#catalog.scopes.filter(scope => scope.canonicalId === scopeId || scope.id === scopeId)
    if (matches.length === 0) throw new Error(`Unknown attached external Storybook scope: ${scopeId}`)
    if (matches.length > 1) throw new Error(`Ambiguous attached external Storybook scope: ${scopeId}`)
    const id = matches[0]!.canonicalId
    const root = this.#entries.find(entry => entry.canonicalId === id)
    const remaining = this.#entries.filter(entry => entry !== root)
    return this.#resolve(
      remaining.map(entry => entry.declarationPath),
      remaining.map(entry => entry.attachSource),
      root === undefined ? [...new Set([...this.#excludedScopes, id])] : this.#excludedScopes,
    )
  }

  async refresh(): Promise<ExternalStorybookRegistrySnapshot> {
    if (this.#entries.length === 0) return this.snapshot()
    return this.#resolve(this.#entries.map(entry => entry.declarationPath), this.#entries.map(entry => entry.attachSource), this.#excludedScopes)
  }

  async #resolve(roots: readonly string[], sources: readonly ExternalStorybookAttachSource[], excludedScopes: readonly string[]): Promise<ExternalStorybookRegistrySnapshot> {
    const raw = roots.length === 0 ? emptyDeclarations() : await this.resolveCatalog(roots)
    return this.#accept(raw, sources, excludedScopes)
  }

  #accept(raw: StorybookCatalog, sources: readonly ExternalStorybookAttachSource[], excludedScopes: readonly string[]): ExternalStorybookRegistrySnapshot {
    const catalog = selectStorybookCatalog(raw, excludedScopes)
    const graph = createExternalStorybookGraph(catalog)
    externalStorybookPackageDescriptors(catalog, graph)
    const entries = createEntries(catalog, graph, sources)
    if (graph.digest === this.#graph.digest && JSON.stringify(excludedScopes) === JSON.stringify(this.#excludedScopes)) return this.snapshot()
    this.#commit(entries, catalog, graph)
    this.#excludedScopes = Object.freeze([...excludedScopes])
    return this.snapshot()
  }

  packageDescriptors(): readonly StorybookPackageBuildDescriptor[] {
    return externalStorybookPackageDescriptors(this.#catalog, this.#graph)
  }

  /** Корни источника включают исключённые ветви, чтобы выбранный проект можно было восстановить. */
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
    this.#excludedScopes = snapshot.excludedScopes
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
