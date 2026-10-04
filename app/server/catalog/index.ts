/**
Открывает дерево Project и данные владельцев с файловой системы.
Обычные чтения не запускают discovery; явное обновление выполняет прежние читатели
в worker и публикует новый набор ссылок после сохранения документов владельцев.

@packageDocumentation
*/
import {type StorybookPackageMetadataCollect as PackageMetadataCollectContract} from "@zavx0z/storybook-package-metadata-collect"
import PackageGraphCreateOwner, {type StorybookPackageGraphCreate as PackageGraphCreateContract} from "@zavx0z/storybook-package-graph-create"
import {type StorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
const createExternalStorybookGraph = PackageGraphCreateOwner
type StorybookCatalog = PackageMetadataCollectContract.Output
type StorybookCatalogScope = PackageMetadataCollectContract.Output["scopes"][number]
type ExternalStorybookGraph = PackageGraphCreateContract.Output
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
import {resolve} from "node:path"
import {statSync} from "node:fs"
import {join} from "node:path"
import {readMetadataSnapshot, restoreMetadataSnapshot} from "./src/storage"
import {prepareCatalogSnapshot} from "./src/prepare"
import {runCatalogWorker} from "./src/worker-client"
import type {CatalogPreparation} from "./src/worker-protocol"

import type {
  ExternalStorybookAttachSource,
  ExternalStorybookRegistryEntry,
  ExternalStorybookRegistrySnapshot,
  ExternalStorybookRegistryDirtySnapshot,
  ExternalStorybookRegistryMetrics,
} from "./contract/models"
import type {StorybookAppServerCatalog} from "./contract"
export type {StorybookAppServerCatalog} from "./contract"
import {scopePaths, emptyCatalog} from "./src/helpers"
/**
В режиме Project источником служит meta/data/tree.json и документы владельцев.
Полный результат обнаружения не удерживается сервером после открытия файлового
хранилища. Независимые читатели могут подготовить снимок через configure перед
первой записью. Неуспешная подготовка не заменяет опубликованное дерево.
*/
export default class ExternalStorybookRegistry {
  readonly #lifetime = new AbortController()
  readonly #workers = new Set<Promise<unknown>>()
  #revision = 0
  #descriptors: readonly StorybookPackageBuildDescriptor[] = Object.freeze([])
  #entries: readonly ExternalStorybookRegistryEntry[] = Object.freeze([])
  #catalog: StorybookCatalog = emptyCatalog()
  #graph: ExternalStorybookGraph = createExternalStorybookGraph(this.#catalog)
  #dirtyPaths = new Set<string>()
  #forceRefresh = false
  #pendingRefresh: Promise<ExternalStorybookRegistrySnapshot> | null = null
  #resolverCalls = 0
  #graphRebuilds = 0
  #cacheHits = 0
  #contractAnalysisSessions = 0
  #dependencyAnalysisSessions = 0
  #metadataProject: Readonly<{root: string, name: string}> | undefined
  #fileSnapshot: {key: string, value: WeakRef<ExternalStorybookRegistrySnapshot>} | undefined

  constructor(
    private readonly resolveCatalog: StorybookAppServerCatalog.Input[0] = undefined,
    private readonly readAuthorStyleSheets: NonNullable<StorybookAppServerCatalog.Input[1]> = () => [],
  ) {}

  snapshot(): ExternalStorybookRegistrySnapshot {
    if (this.#metadataProject !== undefined) {
      const root = this.#metadataProject.root
      const info = statSync(join(root, "meta/data/tree.json"), {bigint: true})
      const key = `${info.ino}:${info.mtimeNs}:${info.size}`
      const previous = this.#fileSnapshot?.key === key ? this.#fileSnapshot.value.deref() : undefined
      if (previous !== undefined) return previous
      const snapshot = readMetadataSnapshot(root, this.readAuthorStyleSheets)
      this.#fileSnapshot = {key, value: new WeakRef(snapshot)}
      return snapshot
    }
    return Object.freeze({
      revision: this.#revision,
      entries: this.#entries,
      catalog: this.#catalog,
      graph: this.#graph,
      descriptors: this.#descriptors,
    })
  }

  /** Открывает данные Project с ФС. Прежний формат переводится без повторного анализа; отсутствие данных запускает первичный сбор. */
  async open(project: Readonly<{root: string, name: string}>, roots: readonly string[]): Promise<ExternalStorybookRegistrySnapshot> {
    if (this.resolveCatalog !== undefined) {
      await this.configure(roots)
      await this.saveMetadata(project)
    } else {
      const result = await this.#runWorker({kind: "open-files", project, roots, sources: roots.map(() => "direct-package"), styles: this.readAuthorStyleSheets()})
      if (result.kind !== "files-ready") throw new Error("Catalog worker returned a different operation")
      if (result.discovered) this.#resolverCalls += 1
      if (result.graphChanged) this.#graphRebuilds += 1
    }
    this.#metadataProject = project
    this.#catalog = emptyCatalog()
    this.#graph = createExternalStorybookGraph(this.#catalog)
    this.#entries = []
    this.#descriptors = []
    return this.snapshot()
  }

  /** Записывает результаты читателей у владельцев; сериализация и запись выполняются вне HTTP-потока. */
  async saveMetadata(project: Readonly<{root: string, name: string}>): Promise<Readonly<{owners: number, changed: number}>> {
    if (this.#metadataProject !== undefined && this.#metadataProject.name === project.name) {
      return {owners: this.snapshot().catalog.scopes.filter(scope => scope.kind === "package").length, changed: 0}
    }
    const result = await this.#runWorker(this.#metadataProject === undefined
      ? {kind: "save-metadata", project, snapshot: this.snapshot()}
      : {kind: "rename-files", project})
    if (result.kind !== "metadata-saved") throw new Error("Catalog worker returned a different operation")
    if (this.#metadataProject !== undefined) this.#metadataProject = project
    return result.result
  }

  async configure(roots: readonly string[]): Promise<ExternalStorybookRegistrySnapshot> {
    return this.#resolve(roots, roots.map(() => "direct-package"))
  }

  async attach(input: string, attachSource: ExternalStorybookAttachSource = "cli"): Promise<ExternalStorybookRegistrySnapshot> {
    return this.attachMany([input], attachSource)
  }

  async attachMany(inputs: readonly string[], attachSource: ExternalStorybookAttachSource = "cli"): Promise<ExternalStorybookRegistrySnapshot> {
    if (inputs.length === 0) return this.snapshot()
    const current = this.snapshot()
    const incoming = await this.#callResolver([...new Set(inputs)])
    if (current.entries.length === 0) return this.#accept(incoming, incoming.rootIds.map(() => attachSource))
    const incomingRoots = incoming.scopes.filter(scope => incoming.rootIds.includes(scope.canonicalId))
    // An explicit ancestor replaces its already selected descendants, avoiding duplicate owners.
    const incomingPaths = new Set(incoming.scopes.map(scope => scope.scopeRoot))
    const exactRoots = new Set(incomingRoots.map(scope => scope.scopeRoot))
    const kept = current.entries.filter(entry => {
      const root = current.catalog.scopes.find(scope => scope.canonicalId === entry.canonicalId)!.scopeRoot
      return exactRoots.has(root) || !incomingPaths.has(root)
    })
    const represented = new Set(current.catalog.scopes.map(scope => scope.scopeRoot))
    const added = incomingRoots.filter(scope => !represented.has(scope.scopeRoot))
    return this.#resolve(
      [...kept.map(entry => entry.declarationPath), ...added.map(scope => scope.source.path)],
      [...kept.map(entry => entry.attachSource), ...added.map(() => attachSource)],
    )
  }

  async detach(scopeId: string): Promise<ExternalStorybookRegistrySnapshot> {
    const catalog = this.snapshot().catalog
    const matches = catalog.scopes.filter(scope => scope.canonicalId === scopeId || scope.id === scopeId)
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous attached external Storybook scope: ${scopeId}`)
    const removed = matches[0]!.canonicalId
    const scopes = new Map(catalog.scopes.map(scope => [scope.canonicalId, scope]))
    const children = (id: string): readonly string[] => {
      const scope = scopes.get(id)!
      return scope.kind === "package" ? scope.packageIds ?? [] : []
    }
    const contains = (id: string): boolean => id === removed || children(id).some(contains)
    const retain = (id: string): readonly string[] => id === removed ? [] :
      contains(id) ? children(id).flatMap(retain) : [scopes.get(id)!.scopeRoot]
    const paths = catalog.rootIds.flatMap(retain)
    return this.#resolve(paths, paths.map(() => "direct-package"))
  }

  refresh(): Promise<ExternalStorybookRegistrySnapshot> {
    if (this.snapshot().entries.length === 0) return Promise.resolve(this.snapshot())
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
    if (this.snapshot().entries.length === 0) return Promise.resolve(this.snapshot())
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
          snapshot.entries.map(entry => entry.declarationPath),
          snapshot.entries.map(entry => entry.attachSource),
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
    this.#lifetime.signal.throwIfAborted()
    if (this.#metadataProject !== undefined) {
      if (this.resolveCatalog !== undefined) {
        const raw = roots.length === 0 ? emptyCatalog() : await this.#callResolver(roots, this.snapshot().catalog, options)
        return this.#accept(raw, sources)
      }
      const result = await this.#runWorker({kind: "refresh-files", project: this.#metadataProject, roots, sources,
        styles: this.readAuthorStyleSheets(), ...(options ?? {})})
      if (result.kind !== "files-ready") throw new Error("Catalog worker returned a different operation")
      if (result.discovered) this.#resolverCalls += 1
      if (result.graphChanged) this.#graphRebuilds += 1
      return this.snapshot()
    }
    if (this.resolveCatalog !== undefined) {
      const raw = roots.length === 0 ? emptyCatalog() : await this.#callResolver(roots, this.#catalog, options)
      return this.#accept(raw, sources)
    }
    this.#resolverCalls += 1
    const prepared = await this.#runWorker({kind: "prepare", roots, sources, previous: this.snapshot(),
      styles: this.readAuthorStyleSheets(), ...(options ?? {})})
    if (prepared.kind !== "prepared") throw new Error("Catalog worker returned a different operation")
    return this.#acceptPrepared(prepared.result)
  }

  async #callResolver(
    roots: readonly string[],
    previous?: StorybookCatalog,
    options?: Readonly<{dirtyScopeRoots?: readonly string[]}>,
  ): Promise<StorybookCatalog> {
    this.#resolverCalls += 1
    if (this.resolveCatalog !== undefined) return this.resolveCatalog(roots, previous, {
      ...options, onAnalysisSession: kind => this.#analysisSession(kind),
    })
    const result = await this.#runWorker({kind: "discover", roots, ...(previous === undefined ? {} : {previous}), ...(options ?? {})})
    if (result.kind !== "discovered") throw new Error("Catalog worker returned a different operation")
    return result.catalog
  }

  #analysisSession(kind: "contract" | "dependency"): void {
    if (kind === "contract") this.#contractAnalysisSessions += 1
    else this.#dependencyAnalysisSessions += 1
  }

  #runWorker(input: Parameters<typeof runCatalogWorker>[0]) {
    const pending = runCatalogWorker(input, this.#lifetime.signal, kind => this.#analysisSession(kind))
    this.#workers.add(pending)
    void pending.finally(() => this.#workers.delete(pending)).catch(() => {})
    return pending
  }

  async #accept(raw: StorybookCatalog, sources: readonly ExternalStorybookAttachSource[]): Promise<ExternalStorybookRegistrySnapshot> {
    if (this.#metadataProject !== undefined) {
      const before = this.snapshot()
      const prepared = prepareCatalogSnapshot(raw, sources, before, this.readAuthorStyleSheets())
      if (prepared.snapshot !== null) {
        const result = await this.#runWorker({kind: "save-metadata", project: this.#metadataProject, snapshot: prepared.snapshot})
        if (result.kind !== "metadata-saved") throw new Error("Catalog worker returned a different operation")
        if (before.graph.digest !== prepared.snapshot.graph.digest) this.#graphRebuilds += 1
      }
      return this.snapshot()
    }
    if (this.resolveCatalog === undefined) {
      const result = await this.#runWorker({kind: "prepare", roots: [], catalog: raw, sources,
        previous: this.snapshot(), styles: this.readAuthorStyleSheets()})
      if (result.kind !== "prepared") throw new Error("Catalog worker returned a different operation")
      return this.#acceptPrepared(result.result)
    }
    return this.#acceptPrepared(prepareCatalogSnapshot(raw, sources, this.snapshot(), this.readAuthorStyleSheets()))
  }

  #acceptPrepared(prepared: CatalogPreparation): ExternalStorybookRegistrySnapshot {
    this.#lifetime.signal.throwIfAborted()
    if (prepared.snapshot === null) return this.snapshot()
    const next = prepared.snapshot
    if (next.revision !== this.#revision + 1) throw new Error("Catalog changed during preparation")
    const previous = new Map(this.#descriptors.map(descriptor => [descriptor.packageId, descriptor]))
    const unchanged = new Set(prepared.unchangedPackageIds)
    this.#descriptors = Object.freeze(next.descriptors.map(descriptor =>
      unchanged.has(descriptor.packageId) ? previous.get(descriptor.packageId)! : Object.freeze(descriptor)))
    const graphUnchanged = next.graph.digest === this.#graph.digest
    this.#commit(next.entries, next.catalog, graphUnchanged ? this.#graph : next.graph)
    if (!graphUnchanged) this.#graphRebuilds += 1
    return this.snapshot()
  }

  /** Остановка владельца отменяет только его незавершённые worker. */
  async dispose(): Promise<void> {
    this.#lifetime.abort(new DOMException("Catalog stopped", "AbortError"))
    await Promise.allSettled([...this.#workers])
  }

  #dirtyScopeRoots(paths: readonly string[]): string[] {
    const scopes = this.snapshot().catalog.scopes.filter((scope): scope is StorybookCatalogScope & {scopeRoot: string} => scope.kind === "package")
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
    return this.snapshot().descriptors
  }

  /** Explicitly selected roots and their physical descendants. */
  async sourceRoots(): Promise<readonly string[]> {
    const snapshot = this.snapshot()
    if (snapshot.entries.length === 0) return Object.freeze([])
    const raw = snapshot.catalog
    return Object.freeze([...new Set(raw.scopes.map(scope => scope.scopeRoot))])
  }

  restore(snapshot: ExternalStorybookRegistrySnapshot): void {
    if (this.#metadataProject !== undefined) {
      restoreMetadataSnapshot(this.#metadataProject.root, snapshot)
      this.#fileSnapshot = undefined
      return
    }
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
