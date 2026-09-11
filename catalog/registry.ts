import type {
  StorybookCatalog,
  StorybookCatalogScope,
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
import {resolve} from "node:path"

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

/** Текущая причина следующего условного обновления реестра. */
export type ExternalStorybookRegistryDirtySnapshot = Readonly<{
  dirty: boolean
  paths: readonly string[]
  scopeRoots: readonly string[]
}>

/** Счётчики работы реестра без смешивания с общей длительностью операции. */
export type ExternalStorybookRegistryMetrics = Readonly<{
  refreshing: boolean
  resolverCalls: number
  graphRebuilds: number
  cacheHits: number
  typescriptApiSessions: Readonly<{
    contract: number
    dependency: number
    total: number
  }>
}>

type ExternalStorybookRegistryResolver = (
  roots: readonly string[],
  previous?: StorybookCatalog,
  options?: Readonly<{
    dirtyScopeRoots?: readonly string[]
    onAnalysisSession?: (kind: "contract" | "dependency") => void
  }>,
) => Promise<StorybookCatalog>

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
  #dirtyPaths = new Set<string>()
  #forceRefresh = false
  #pendingRefresh: Promise<ExternalStorybookRegistrySnapshot> | null = null
  #resolverCalls = 0
  #graphRebuilds = 0
  #cacheHits = 0
  #contractAnalysisSessions = 0
  #dependencyAnalysisSessions = 0

  constructor(private readonly resolveCatalog: ExternalStorybookRegistryResolver) {}

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
    const incoming = await this.#callResolver([...new Set(inputs)])
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

  refresh(): Promise<ExternalStorybookRegistrySnapshot> {
    if (this.#entries.length === 0) return Promise.resolve(this.snapshot())
    this.#forceRefresh = true
    return this.#requestRefresh()
  }

  /**
  Помечает путь структурного источника для следующего условного обновления.

  Точное совпадение с `structurePaths` помечает всех потребителей общего источника.
  Неизвестный путь внутри пакета принадлежит ближайшему package root. Путь вне
  известных владельцев переводит обновление в безопасный полный режим.

  @param input - Абсолютный путь из общего watcher либо массив таких путей.
  */
  markDirty(input: string | readonly string[]): ExternalStorybookRegistryDirtySnapshot {
    for (const path of typeof input === "string" ? [input] : input) {
      if (typeof path !== "string" || path.length === 0) throw new TypeError("Storybook dirty path must be a non-empty string")
      this.#dirtyPaths.add(resolve(path))
    }
    return this.dirtySnapshot()
  }

  /** Возвращает причины следующего условного обновления без запуска resolver. */
  dirtySnapshot(): ExternalStorybookRegistryDirtySnapshot {
    const paths = Object.freeze([...this.#dirtyPaths].sort())
    return Object.freeze({
      dirty: this.#forceRefresh || paths.length > 0,
      paths,
      scopeRoots: Object.freeze(this.#dirtyScopeRoots(paths)),
    })
  }

  /** Возвращает отдельные показатели warm-hit, resolver и принятого graph candidate. */
  metrics(): ExternalStorybookRegistryMetrics {
    return Object.freeze({
      refreshing: this.#pendingRefresh !== null,
      resolverCalls: this.#resolverCalls,
      graphRebuilds: this.#graphRebuilds,
      cacheHits: this.#cacheHits,
      typescriptApiSessions: Object.freeze({
        contract: this.#contractAnalysisSessions,
        dependency: this.#dependencyAnalysisSessions,
        total: this.#contractAnalysisSessions + this.#dependencyAnalysisSessions,
      }),
    })
  }

  /**
  Обновляет только помеченных владельцев и переиспользует текущий снимок при чистом реестре.

  Параллельные запросы разделяют один Promise. Пометка, поступившая во время resolver,
  выполняется следующим проходом до завершения этого Promise.
  */
  refreshIfNeeded(): Promise<ExternalStorybookRegistrySnapshot> {
    if (this.#entries.length === 0) return Promise.resolve(this.snapshot())
    if (!this.#forceRefresh && this.#dirtyPaths.size === 0 && this.#pendingRefresh === null) {
      this.#cacheHits += 1
      return Promise.resolve(this.snapshot())
    }
    return this.#requestRefresh()
  }

  #requestRefresh(): Promise<ExternalStorybookRegistrySnapshot> {
    if (this.#pendingRefresh !== null) return this.#pendingRefresh
    const pending = this.#drainRefreshes().finally(() => {
      if (this.#pendingRefresh === pending) this.#pendingRefresh = null
    })
    this.#pendingRefresh = pending
    return pending
  }

  async #drainRefreshes(): Promise<ExternalStorybookRegistrySnapshot> {
    let snapshot = this.snapshot()
    while (this.#forceRefresh || this.#dirtyPaths.size > 0) {
      const force = this.#forceRefresh
      const paths = [...this.#dirtyPaths]
      this.#forceRefresh = false
      this.#dirtyPaths.clear()
      try {
        snapshot = await this.#resolve(
          this.#entries.map(entry => entry.declarationPath),
          this.#entries.map(entry => entry.attachSource),
          force ? undefined : {dirtyScopeRoots: this.#dirtyScopeRoots(paths)},
        )
      } catch (error) {
        if (force) this.#forceRefresh = true
        for (const path of paths) this.#dirtyPaths.add(path)
        throw error
      }
    }
    return snapshot
  }

  async #resolve(
    roots: readonly string[],
    sources: readonly ExternalStorybookAttachSource[],
    options?: Readonly<{dirtyScopeRoots?: readonly string[]}>,
  ): Promise<ExternalStorybookRegistrySnapshot> {
    const raw = roots.length === 0 ? emptyDeclarations() : await this.#callResolver(roots, this.#catalog, options)
    return this.#accept(raw, sources)
  }

  async #callResolver(
    roots: readonly string[],
    previous?: StorybookCatalog,
    options?: Readonly<{dirtyScopeRoots?: readonly string[]}>,
  ): Promise<StorybookCatalog> {
    this.#resolverCalls += 1
    return this.resolveCatalog(roots, previous, {
      ...options,
      onAnalysisSession: kind => {
        if (kind === "contract") this.#contractAnalysisSessions += 1
        else this.#dependencyAnalysisSessions += 1
      },
    })
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
    const graphUnchanged = graph.digest === this.#graph.digest
    if (graphUnchanged &&
      JSON.stringify(catalog.scopes.map(scope => [scope.resolutionError, scope.structurePaths])) ===
      JSON.stringify(this.#catalog.scopes.map(scope => [scope.resolutionError, scope.structurePaths])) &&
      JSON.stringify(descriptors) === JSON.stringify(this.#descriptors)) return this.snapshot()
    this.#descriptors = descriptors
    this.#commit(entries, catalog, graphUnchanged ? this.#graph : graph)
    if (!graphUnchanged) this.#graphRebuilds += 1
    return this.snapshot()
  }

  #dirtyScopeRoots(paths: readonly string[]): string[] {
    const scopes = this.#catalog.scopes.filter((scope): scope is StorybookCatalogScope & {scopeRoot: string} => scope.kind === "package")
    const roots = new Set<string>()
    for (const path of paths) {
      const exact = scopes.filter(scope => scopePaths(scope).has(path))
      if (exact.length > 0) {
        for (const scope of exact) roots.add(scope.scopeRoot)
        continue
      }
      const contained = scopes
        .filter(scope => path === scope.scopeRoot || path.startsWith(`${scope.scopeRoot}/`))
        .sort((left, right) => right.scopeRoot.length - left.scopeRoot.length)
      if (contained[0] !== undefined) {
        roots.add(contained[0].scopeRoot)
        continue
      }
      for (const scope of scopes) roots.add(scope.scopeRoot)
    }
    return [...roots].sort()
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

function scopePaths(scope: StorybookCatalogScope): ReadonlySet<string> {
  return new Set([
    resolve(scope.source.path),
    resolve(scope.scopeRoot),
    resolve(scope.scopeRoot, "package.json"),
    ...(scope.readmePath === null ? [] : [resolve(scope.readmePath)]),
    ...(scope.structurePaths ?? []).map(path => resolve(path)),
    ...(scope.kind === "package" ? [
      resolve(scope.packageJsonPath),
      ...scope.authorStyleSheets.flatMap(sheet => [resolve(sheet.path), resolve(sheet.ownerPackageJsonPath)]),
      ...(scope.catalog?.sourcePaths ?? []).map(path => resolve(path)),
    ] : []),
  ])
}

function emptyDeclarations(): StorybookCatalog {
  return Object.freeze({
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    rootIds: Object.freeze([]),
    scopes: Object.freeze([]),
  })
}
