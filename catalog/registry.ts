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

  async attach(
    input: string,
    attachSource: ExternalStorybookAttachSource = "cli",
  ): Promise<ExternalStorybookRegistrySnapshot> {
    const candidateInputs = [...this.#entries.map(({declarationPath}) => declarationPath), input]
    const candidateDeclarations = await this.resolveCatalog(candidateInputs)
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
    const candidateDeclarations = await this.resolveCatalog(candidateInputs)
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
    const candidateDeclarations = await this.resolveCatalog(
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
    const candidateDeclarations = await this.resolveCatalog(
      this.#entries.map(({declarationPath}) => declarationPath),
    )
    const candidateGraph = createExternalStorybookGraph(candidateDeclarations)
    externalStorybookPackageDescriptors(candidateDeclarations, candidateGraph)
    const candidateEntries = createEntries(
      candidateDeclarations,
      candidateGraph,
      this.#entries.map(({attachSource}) => attachSource),
    )
    if (candidateGraph.digest === this.#graph.digest) return this.snapshot()
    this.#commit(candidateEntries, candidateDeclarations, candidateGraph)
    return this.snapshot()
  }

  packageDescriptors(): readonly StorybookPackageBuildDescriptor[] {
    return externalStorybookPackageDescriptors(this.#catalog, this.#graph)
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
