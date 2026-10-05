/**
Лаунчер и управляющий API единого Storybook. Соединяет запуск готового сервера,
каталог, подготовку, применение и инспекцию через один авторизованный канал.
MCP и package.json scripts вызывают эти же операции; создание API не запускает сервер.

@packageDocumentation
*/
import ServerState, {type StorybookAppServerState} from "@zavx0z/storybook-app-server-state"
const {readExternalStorybookOperationProgress, readExternalStorybookStartupProgress, writeExternalStorybookStartupProgress, acquireExternalStorybookStartLease, clearExternalStorybookMigrationRecord, externalStorybookLegacyStatePaths, externalStorybookServerStatePath, inspectExternalStorybookServer, publishExternalStorybookStartCandidate, readExternalStorybookMigrationRecord, removeReplaceableExternalStorybookState, writeExternalStorybookMigrationRecord} = ServerState
type ExternalStorybookMigrationRecord = NonNullable<ReturnType<StorybookAppServerState.Output["readExternalStorybookMigrationRecord"]>>
type ExternalStorybookServerRecord = ReturnType<StorybookAppServerState.Output["readExternalStorybookServerRecord"]>
import {createHmac} from "node:crypto"
import {closeSync, constants, existsSync, fchmodSync, fstatSync, openSync, readSync, realpathSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join, resolve} from "node:path"
import {
  type StorybookAttachInput,
  type StorybookCaptureInput,
  type StorybookCaptureResult,
  type StorybookCheckInput,
  type StorybookCloseInput,
  type StorybookControllerContext,
  type StorybookControllerResult,
  type StorybookDetachInput,
  type StorybookEnsureInput,
  type StorybookInspectInput,
  type StorybookInteractInput,
  type StorybookOpenInput,
  type StorybookResourceResult,
  type StorybookSearchInput,
  type StorybookStatusInput,
  type StorybookStopInput,
  type StorybookWaitInput,
} from "./src/control-types"


import type {StorybookApp} from "./contract"
export type {StorybookApp} from "./contract"

/**
Создаёт управление приложением без запуска серверного процесса или компиляции.

@param options - Корень готового приложения и операции запуска принадлежащего ему daemon.
@returns API запуска, состояния, подготовки и применения с явным контекстом отмены.
*/
export default function createApp(options: StorybookApp.Input = {}): StorybookApp.Output {
  type ClientSnapshot = Readonly<{
    graphDigest: string
    rootIds: readonly string[]
    nodes: readonly Readonly<Record<string, unknown>>[]
    packages: readonly Readonly<Record<string, unknown>>[]
  }>

  type SpawnedStorybookDaemon = ReturnType<NonNullable<StorybookApp.Input["spawnDaemon"]>>

  const DAEMON_STDERR_TAIL_LENGTH = 2_048

  type CreateExternalStorybookControllerOptions = StorybookApp.Input

  /** One typed application service shared by human CLI and Storybook MCP. */
  class ExternalStorybookController implements StorybookApp.Output {
    readonly #toolRoot: string
    readonly #daemonEntryPath: string
    readonly #spawnDaemon: (input: Readonly<{
      entryPath: string
      toolRoot: string
      declarations: readonly string[]
      preferredPort?: number
      startLease: Readonly<{path: string; token: string}>
    }>) => SpawnedStorybookDaemon
    readonly #legacyStatePaths: readonly string[]

    constructor(options: CreateExternalStorybookControllerOptions = {}) {
      this.#toolRoot = realpathSync(options.toolRoot ?? fileURLToPath(new URL("..", import.meta.url)))
      this.#daemonEntryPath = realpathSync(options.daemonEntryPath ?? fileURLToPath(
        new URL("./src/daemon-entry.ts", import.meta.url),
      ))
      this.#spawnDaemon = options.spawnDaemon ?? spawnCanonicalDaemon
      this.#legacyStatePaths = Object.freeze([...(options.legacyStatePaths ?? externalStorybookLegacyStatePaths())])
    }

    /**
    Использует работающий daemon; при новом запуске передаёт стадии из stderr
    и подтверждённую готовность через onProgress. Ждёт отправки перед возвратом результата.
    */
    async ensure(input: StorybookEnsureInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      const roots = canonicalRoots(input.roots ?? Object.freeze([]))
      const record = await this.#ensureRunning(context.signal, context.onProgress)
      const client = ServerState.client(record)
      if (roots.length > 0) {
        const status = await client.read("/api/control/status", context.signal)
        const attached = new Set(Array.isArray(status.entries) ? status.entries.flatMap((candidate) =>
          candidate !== null && typeof candidate === "object" && typeof (candidate as Record<string, unknown>).declarationPath === "string"
            ? [(candidate as Record<string, unknown>).declarationPath as string]
            : []) : [])
        const missing = roots.filter((root) => !attached.has(resolveManifestPath(root)))
        if (missing.length > 0) await client.control("/api/control/attach", {roots: missing}, context.signal)
      }
      await client.control("/api/control/refresh", {force: false}, context.signal)
      return this.#statusResult(record, false, context.signal)
    }

    async status(input: StorybookStatusInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      const inspection = await inspectExternalStorybookServer()
      assertOwnedStorybookState(inspection, this.#toolRoot)
      if (inspection.state !== "running" || inspection.record === null) {
        const startup = readExternalStorybookStartupProgress(this.#toolRoot)
        if (startup !== null) return Object.freeze({status: "success", server: "starting", startup})
        const lastObservedProgress = inspection.record === null ? null : readExternalStorybookOperationProgress(inspection.record)
        return Object.freeze({status: "success", server: inspection.state, reason: inspection.reason,
          ...(lastObservedProgress === null ? {} : {lastObservedProgress})})
      }
      return this.#statusResult(inspection.record, input.includeViews === true, context.signal, input.scope)
    }

    async attach(input: StorybookAttachInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      const roots = canonicalRoots([input.root])
      const record = await this.#ensureRunning(context.signal)
      const client = ServerState.client(record)
      await client.control("/api/control/attach", {roots}, context.signal)
      return this.#statusResult(record, true, context.signal)
    }

    async detach(input: StorybookDetachInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      const record = await this.#requireRunning()
      const client = ServerState.client(record)
      await client.control("/api/control/detach", {scopeId: input.scopeId}, context.signal)
      return this.#statusResult(record, true, context.signal)
    }

    async search(input: StorybookSearchInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      const record = await this.#requireRunning()
      const snapshot = await this.#clientSnapshot(record, context.signal)
      const terms = input.query.toLocaleLowerCase("en-US").split(/\s+/u).filter(Boolean)
      const kinds = input.kinds === undefined ? null : new Set(input.kinds)
      const filtered = snapshot.nodes.filter((node) => {
        if (input.packageId !== undefined && node.packageId !== input.packageId) return false
        if (kinds !== null && !kinds.has(node.kind as never)) return false
        const haystack = [node.id, node.kind, node.label, node.apiName, node.routePath,
          ...(Array.isArray(node.searchTerms) ? node.searchTerms : [])]
          .filter((value): value is string => typeof value === "string")
          .join(" ").toLocaleLowerCase("en-US")
        return terms.every((term) => haystack.includes(term))
      })
      const offset = decodeCursor(input.cursor)
      const limit = input.limit ?? 40
      const page = filtered.slice(offset, offset + limit).map((node) => Object.freeze({
        nodeId: node.id,
        kind: node.kind,
        packageId: node.packageId,
        label: node.label,
        route: node.routePath,
        owner: node.ownerId,
        parentId: node.parentId,
        structuralPath: compactStructuralPath(snapshot.nodes, node),
      }))
      return Object.freeze({
        status: "success",
        graphDigest: snapshot.graphDigest,
        results: Object.freeze(page),
        nextCursor: offset + page.length < filtered.length ? encodeCursor(offset + page.length) : null,
      })
    }

    async open(input: StorybookOpenInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      const record = await this.#ensureRunning(context.signal)
      const client = ServerState.client(record)
      const result = await client.control("/api/control/open", {
        packageId: input.packageId,
        route: input.route ?? "",
        ...(input.recover === undefined ? {} : {recover: input.recover}),
      }, context.signal)
      const {package: packageSnapshot, ok, ...publicResult} = result
      const projectedPackage = publicPackageSnapshot(packageSnapshot)
      return Object.freeze({
        ...publicResult,
        status: ok === true ? "success" : "failed",
        ...(projectedPackage === null ? {} : {package: projectedPackage}),
      })
    }

    async wait(input: StorybookWaitInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      const record = await this.#requireRunning()
      if (input.viewId !== undefined && (input.condition === "ready" || input.condition === "presented")) {
        const timeoutSignal = AbortSignal.timeout(input.timeoutMs ?? 30_000)
        try {
          return await this.#waitForView(record, Object.freeze({
            ...input,
            viewId: input.viewId,
            condition: input.condition,
          }), AbortSignal.any([context.signal, timeoutSignal]))
        } catch (error) {
          if (!timeoutSignal.aborted || context.signal.aborted) throw error
          return Object.freeze({
            status: "timeout",
            condition: input.condition,
            reached: false,
            previousRevision: input.afterRevision ?? null,
            currentRevision: null,
            viewId: input.viewId,
          })
        }
      }
      const client = ServerState.client(record)
      const result = await client.control("/api/control/wait", {
        packageId: input.packageId ?? null,
        viewId: input.viewId ?? null,
        afterRevision: input.afterRevision ?? null,
        condition: input.condition,
        timeoutMs: input.timeoutMs ?? 30_000,
      }, context.signal)
      const {package: packageSnapshot, ...publicResult} = result
      const projectedPackage = publicPackageSnapshot(packageSnapshot)
      return Object.freeze({
        ...publicResult,
        status: result.timeout === true ? "timeout" : "success",
        ...(projectedPackage === null ? {} : {package: projectedPackage}),
      })
    }

    async #waitForView(
      record: ExternalStorybookServerRecord,
      input: StorybookWaitInput & Readonly<{viewId: string; condition: "ready" | "presented"}>,
      signal: AbortSignal,
    ): Promise<StorybookControllerResult> {
      const timeoutMs = input.timeoutMs ?? 30_000
      const deadline = Date.now() + timeoutMs
      const client = ServerState.client(record)
      const exactView = await client.read(
        `/api/control/views/${encodeURIComponent(input.viewId)}`,
        signal,
      )
      const view = exactView.view !== null && typeof exactView.view === "object" && !Array.isArray(exactView.view)
        ? exactView.view as Record<string, unknown>
        : undefined
      if (view === undefined) throw new Error(`Invalid Storybook view: ${input.viewId}`)
      const packageId = String(view.packageId)
      const route = String(view.route ?? "")
      if (input.packageId !== undefined && input.packageId !== packageId) {
        throw new Error(`Storybook wait view belongs to ${packageId}, not ${input.packageId}`)
      }
      let inspected: Readonly<Record<string, unknown>> | null = null
      try {
        const result = await client.control("/api/control/inspect", {
          viewId: input.viewId,
          include: ["state"],
        }, signal)
        const {ok: _ok, ...projection} = result
        inspected = Object.freeze(projection)
      } catch {
        // A reload may temporarily destroy the bridge; package events remain authoritative.
      }
      if (inspected !== null && viewConditionReached(inspected, input.condition, input.afterRevision)) {
        return Object.freeze({
          status: "success",
          condition: input.condition,
          reached: true,
          previousRevision: input.afterRevision ?? null,
          currentRevision: inspected.revision,
          view: inspected,
        })
      }
      const remaining = deadline - Date.now()
      if (remaining < 100) return Object.freeze({
        status: "timeout",
        condition: input.condition,
        reached: false,
        previousRevision: input.afterRevision ?? null,
        currentRevision: inspected?.revision ?? null,
        view: Object.freeze(view),
      })
      const waited = await client.control("/api/control/wait", {
        packageId,
        viewId: input.viewId,
        afterRevision: input.afterRevision ?? null,
        condition: "active",
        timeoutMs: remaining,
      }, signal)
      if (waited.timeout === true || typeof waited.currentRevision !== "string") {
        return Object.freeze({
          status: "timeout",
          condition: input.condition,
          reached: false,
          previousRevision: input.afterRevision ?? null,
          currentRevision: waited.currentRevision ?? null,
          ...(publicPackageSnapshot(waited.package) === null ? {} : {package: publicPackageSnapshot(waited.package)}),
          view: Object.freeze(view),
        })
      }
      const opened = await client.control("/api/control/open", {
        packageId,
        route,
        timeoutMs: Math.max(100, deadline - Date.now()),
      }, signal)
      const reached = opened.ready === true &&
        (input.condition === "ready" || opened.presented === true) &&
        opened.revision !== input.afterRevision
      const {package: packageSnapshot, ok: _ok, ...publicView} = opened
      const projectedPackage = publicPackageSnapshot(packageSnapshot)
      return Object.freeze({
        status: reached ? "success" : "timeout",
        condition: input.condition,
        reached,
        previousRevision: input.afterRevision ?? null,
        currentRevision: opened.revision,
        ...(projectedPackage === null ? {} : {package: projectedPackage}),
        view: Object.freeze(publicView),
      })
    }

    async inspect(input: StorybookInspectInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      const record = await this.#requireRunning()
      const result = await ServerState.client(record).control("/api/control/inspect", {
        viewId: input.viewId,
        ...(input.include === undefined ? {} : {include: input.include}),
        ...(input.maxDepth === undefined ? {} : {maxDepth: input.maxDepth}),
        ...(input.limit === undefined ? {} : {limit: input.limit}),
        ...(input.cursor === undefined ? {} : {cursor: input.cursor}),
      }, context.signal)
      const {ok: _ok, ...publicResult} = result
      return Object.freeze({status: "success", ...publicResult})
    }

    async interact(input: StorybookInteractInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      const record = await this.#requireRunning()
      const {schemaVersion: _schemaVersion, ...operation} = input
      const result = await ServerState.client(record).control(
        "/api/control/interact",
        operation,
        context.signal,
      )
      const {ok: _ok, ...publicResult} = result
      return Object.freeze({status: "success", ...publicResult})
    }

    async capture(input: StorybookCaptureInput, context: StorybookControllerContext): Promise<StorybookCaptureResult> {
      const record = await this.#requireRunning()
      let viewId = input.viewId
      if (viewId === undefined) {
        if (input.packageId === undefined) throw new Error("Storybook capture requires viewId or packageId")
        const opened = await this.open({
          schemaVersion: 1,
          packageId: input.packageId,
          route: input.route ?? "",
        }, context)
        if (typeof opened.viewId !== "string") throw new Error("Storybook capture could not open its package view")
        viewId = opened.viewId
      } else if (input.packageId !== undefined || input.route !== undefined) {
        const exactView = await ServerState.client(record).read(
          `/api/control/views/${encodeURIComponent(viewId)}`,
          context.signal,
        )
        const view = exactView.view !== null && typeof exactView.view === "object" && !Array.isArray(exactView.view)
          ? exactView.view as Record<string, unknown>
          : undefined
        if (view === undefined) throw new Error(`Invalid Storybook view: ${viewId}`)
        const packageId = String(view.packageId)
        if (input.packageId !== undefined && input.packageId !== packageId) {
          throw new Error(`Storybook capture view belongs to ${packageId}, not ${input.packageId}`)
        }
        const opened = await this.open({
          schemaVersion: 1,
          packageId,
          route: input.route ?? String(view.route ?? ""),
        }, context)
        if (opened.viewId !== viewId) throw new Error(`Storybook capture view identity changed: ${viewId}`)
      }
      const result = await ServerState.client(record).control("/api/control/capture", {
        viewId,
        area: input.area,
        ...(input.nodeId === undefined ? {} : {nodeId: input.nodeId}),
        ...(input.failOnConsoleError === undefined ? {} : {failOnConsoleError: input.failOnConsoleError}),
        ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
      }, context.signal)
      const {ok: _ok, ...publicResult} = result
      return Object.freeze({status: "success", ...publicResult}) as StorybookCaptureResult
    }

    async check(input: StorybookCheckInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      if (input.scope === "storybook:web") {
        context.signal.throwIfAborted()
        const record = await this.#requireRunning()
        context.signal.throwIfAborted()
        const result = await ServerState.client(record).controlStream(
          "/api/control/app/web/rebuild",
          {},
          context.onProgress,
          context.signal,
        )
        return Object.freeze({...result, status: result.ok === true ? "success" : "failed"})
      }
      context.signal.throwIfAborted()
      const pathScope = existsSync(input.scope) ? realpathSync(input.scope) : null
      if (pathScope !== null) {
        await this.ensure({schemaVersion: 1, roots: [pathScope]}, {signal: context.signal})
      }
      const record = pathScope === null
        ? await this.#ensureRunning(context.signal)
        : await this.#requireRunning()
      context.signal.throwIfAborted()
      const client = ServerState.client(record)
      const result = await client.controlStream("/api/control/check", {
        scope: pathScope ?? canonicalScope(input.scope),
      }, context.onProgress, context.signal)
      const packages = Array.isArray(result.packages) ? result.packages.map(publicPackageSnapshot).filter(Boolean) : []
      return Object.freeze({
        status: result.ok === true ? "success" : "failed",
        ok: result.ok === true,
        graphDigest: result.graphDigest,
        ...(result.shared === undefined ? {} : {shared: result.shared, hosts: result.hosts, published: result.published}),
        packages,
        applied: result.applied === true,
        views: result.views ?? [],
      })
    }

    async close(input: StorybookCloseInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      const record = await this.#requireRunning()
      const result = await ServerState.client(record).control(
        "/api/control/close",
        {viewId: input.viewId},
        context.signal,
      )
      const {ok: _ok, ...publicResult} = result
      return Object.freeze({status: "success", ...publicResult})
    }

    async stop(input: StorybookStopInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
      if (input.confirm !== true) throw new Error("Storybook stop requires confirm: true")
      const inspection = await inspectExternalStorybookServer()
      if (inspection.state !== "running" || inspection.record === null) {
        throw new Error("External Storybook server is not running")
      }
      assertOwnedStorybookState(inspection, this.#toolRoot)
      const record = inspection.record
      persistMigrationRecord(this.#toolRoot, record.attachedDeclarations, Number(new URL(record.origin).port))
      await stopOwnedDaemon(record, context.signal, externalStorybookServerStatePath())
      return Object.freeze({status: "success", stopped: true, instanceId: record.instanceId})
    }

    async readResource(uri: string, context: StorybookControllerContext): Promise<StorybookResourceResult> {
      const parsed = new URL(uri)
      if (parsed.protocol !== "storybook:") throw new Error(`Unsupported Storybook resource URI: ${uri}`)
      if (uri === "storybook://state") return jsonResource(uri, await this.status({schemaVersion: 1, includeViews: true}, context))
      const record = await this.#requireRunning()
      const snapshot = await this.#clientSnapshot(record, context.signal)
      if (uri === "storybook://graph") {
        return jsonResource(uri, {
          graphDigest: snapshot.graphDigest,
          rootIds: snapshot.rootIds,
          nodes: snapshot.nodes.slice(0, 100).map(compactGraphNode),
          nextCursor: snapshot.nodes.length > 100 ? encodeCursor(100) : null,
        })
      }
      if (parsed.hostname === "packages") {
        const packageId = decodeURIComponent(parsed.pathname.slice(1))
        const packageState = snapshot.packages.find((candidate) => candidate.packageId === packageId)
        if (packageState === undefined) throw new Error(`Unknown Storybook package resource: ${packageId}`)
        return jsonResource(uri, {
          package: packageState,
          nodes: snapshot.nodes.filter((node) => node.packageId === packageId).map(compactGraphNode),
        })
      }
      if (parsed.hostname === "views") {
        const viewId = parsed.pathname.slice(1)
        const result = await ServerState.client(record).control("/api/control/inspect", {
          viewId,
          include: ["state", "diagnostics"],
          limit: 40,
        }, context.signal)
        const {ok: _ok, ...publicResult} = result
        return jsonResource(uri, publicResult)
      }
      if (parsed.hostname === "captures") {
        const captureId = parsed.pathname.slice(1)
        const capture = await ServerState.client(record).read(
          `/api/control/captures/${encodeURIComponent(captureId)}`,
          context.signal,
        )
        if (typeof capture.data !== "string") throw new Error(`Storybook capture resource is invalid: ${captureId}`)
        return Object.freeze({
          status: "success",
          uri,
          mimeType: "image/png",
          blob: capture.data,
        })
      }
      throw new Error(`Unknown Storybook resource URI: ${uri}`)
    }

    async #statusResult(
      record: ExternalStorybookServerRecord,
      includeViews: boolean,
      signal: AbortSignal,
      scope?: string,
    ): Promise<StorybookControllerResult> {
      const client = ServerState.client(record)
      const value = await client.read(scope === undefined ? "/api/control/status" :
        `/api/control/status?scope=${encodeURIComponent(scope)}`, signal)
      const exactPackageScope = scope !== undefined && Array.isArray(value.packages) &&
        value.packages.some(item => item !== null && typeof item === "object" && (item as Record<string, unknown>).packageId === scope)
      const preflightIds = Array.isArray((value.preflight as {packageIds?: unknown})?.packageIds)
        ? new Set((value.preflight as {packageIds: string[]}).packageIds)
        : exactPackageScope ? new Set([scope!]) : null
      const packages = Array.isArray(value.packages)
        ? value.packages.filter((candidate) => scope === undefined || preflightIds === null ||
          candidate !== null && typeof candidate === "object" &&
          preflightIds.has((candidate as Record<string, unknown>).packageId as string))
          .map(publicPackageSnapshot)
        : []
      const viewsPath = exactPackageScope ? `/api/control/views?packageId=${encodeURIComponent(scope!)}` : "/api/control/views"
      const viewsResult = includeViews ? await client.read(viewsPath, signal) : null
      const views = viewsResult === null
        ? undefined
        : Array.isArray(viewsResult.views)
          ? viewsResult.views.filter(view => scope === undefined || preflightIds === null ||
            view !== null && typeof view === "object" && preflightIds.has((view as Record<string, unknown>).packageId as string))
          : []
      return Object.freeze({
        status: "success",
        server: "running",
        instanceId: record.instanceId,
        origin: publicOriginIdentity(record),
        registryRevision: value.registryRevision,
        graphDigest: value.graphDigest,
        attachedRoots: Array.isArray(value.entries)
          ? value.entries.map((entry) => publicRoot(entry)).filter(Boolean)
          : [],
        packages,
        declarationErrors: value.declarationErrors ?? [],
        sharedBuildError: value.sharedBuildError ?? null,
        requestJournal: value.requestJournal ?? null,
        buildScheduler: value.buildScheduler ?? null,
        app: value.app ?? null,
        discovery: value.discovery ?? null,
        preflight: value.preflight ?? {
          scopeResolved: scope === undefined || exactPackageScope,
          packageIds: scope === undefined ? packages.map(item => item?.packageId) : exactPackageScope ? [scope] : null,
        },
        scopeProjection: scope === undefined ? "all" : preflightIds === null ? "unavailable" : "exact",
        ...(views === undefined ? {} : {views}),
      })
    }

    async #clientSnapshot(record: ExternalStorybookServerRecord, signal: AbortSignal): Promise<ClientSnapshot> {
      const value = await ServerState.client(record).read("/api/client", signal)
      if (typeof value.graphDigest !== "string" || !Array.isArray(value.rootIds) ||
        !Array.isArray(value.nodes) || !Array.isArray(value.packages)) {
        throw new Error("External Storybook client snapshot is invalid")
      }
      return value as unknown as ClientSnapshot
    }

    async #ensureRunning(signal: AbortSignal, onProgress?: StorybookControllerContext["onProgress"]): Promise<ExternalStorybookServerRecord> {
      let inspection = await inspectExternalStorybookServer()
      assertOwnedStorybookState(inspection, this.#toolRoot)
      let migration = readExternalStorybookMigrationRecord()
      assertOwnedMigrationRecord(migration, this.#toolRoot)
      const legacyStatePaths = this.#legacyStatePaths
      if (ownedRunningRecord(inspection, this.#toolRoot) &&
        !legacyStatePaths.some(existsSync) && migration === null) return inspection.record!
      let lease: ReturnType<typeof acquireExternalStorybookStartLease> | null = null
      try {
        while (lease === null) {
          signal.throwIfAborted()
          try {
            lease = acquireExternalStorybookStartLease()
          } catch (error) {
            if (!String(error).includes("start is already in progress")) throw error
            inspection = await inspectExternalStorybookServer()
            assertOwnedStorybookState(inspection, this.#toolRoot)
            migration = readExternalStorybookMigrationRecord()
            assertOwnedMigrationRecord(migration, this.#toolRoot)
            if (ownedRunningRecord(inspection, this.#toolRoot) &&
              !legacyStatePaths.some(existsSync) && migration === null) return inspection.record!
            await Bun.sleep(50)
          }
        }
        migration = await migrateLegacyStorybookState(legacyStatePaths, this.#toolRoot, signal, migration)
        inspection = await inspectExternalStorybookServer()
        assertOwnedStorybookState(inspection, this.#toolRoot)
        if (ownedRunningRecord(inspection, this.#toolRoot)) {
          const record = inspection.record!
          if (migration !== null) clearExternalStorybookMigrationRecord(this.#toolRoot)
          return record
        }
        let declarations: readonly string[] = migration?.declarations ?? Object.freeze([])
        let preferredPort: number | undefined = migration?.preferredPort
        if (inspection.record !== null && (inspection.state === "running" ||
          inspection.state === "stale" && inspection.replaceable)) {
          declarations = mergeDeclarations(inspection.record.attachedDeclarations, declarations)
          preferredPort = Number(new URL(inspection.record.origin).port)
          migration = persistMigrationRecord(this.#toolRoot, declarations, preferredPort)
        }
        if (inspection.state === "running" && inspection.record !== null) {
          await stopOwnedDaemon(inspection.record, signal, externalStorybookServerStatePath())
          inspection = await inspectExternalStorybookServer()
          assertOwnedStorybookState(inspection, this.#toolRoot)
          if (ownedRunningRecord(inspection, this.#toolRoot)) {
            const record = inspection.record!
            if (migration !== null) clearExternalStorybookMigrationRecord(this.#toolRoot)
            return record
          }
        }
        if (inspection.state === "stale") {
          if (!inspection.replaceable) throw new Error(`Refusing ambiguous Storybook stale state: ${inspection.reason}`)
          removeReplaceableExternalStorybookState(inspection)
        }
        writeExternalStorybookStartupProgress(lease, this.#toolRoot, {phase: "starting", at: Date.now()})
        const child = this.#spawnDaemon({
          entryPath: this.#daemonEntryPath,
          toolRoot: this.#toolRoot,
          declarations,
          ...(preferredPort === undefined ? {} : {preferredPort}),
          startLease: Object.freeze({path: lease.path, token: lease.token}),
        })
        try {
          const record = await waitForRunning(
            signal,
            this.#toolRoot,
            child,
            Object.freeze({path: lease.path, token: lease.token}),
            onProgress,
          )
          child.unref()
          if (migration !== null) clearExternalStorybookMigrationRecord(this.#toolRoot)
          return record
        } catch (error) {
          const current = await inspectExternalStorybookServer()
          if (current.state === "running" && current.record?.pid === child.pid &&
            ownedRunningRecord(current, this.#toolRoot)) {
            child.unref()
          } else {
            await terminateSpawnedDaemon(child)
          }
          throw error
        }
      } finally {
        lease?.release()
      }
    }

    async #requireRunning(): Promise<ExternalStorybookServerRecord> {
      const inspection = await inspectExternalStorybookServer()
      assertOwnedStorybookState(inspection, this.#toolRoot)
      if (inspection.state !== "running" || inspection.record === null) {
        throw new Error("External Storybook server is not running")
      }
      return inspection.record
    }

  }

  function spawnCanonicalDaemon(input: Readonly<{
    entryPath: string
    toolRoot: string
    declarations: readonly string[]
    preferredPort?: number
    startLease: Readonly<{path: string; token: string}>
  }>): SpawnedStorybookDaemon {
    const path = `${externalStorybookServerStatePath()}.stderr.log`
    const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
    try {
      if (!fstatSync(descriptor).isFile()) throw new Error("Storybook daemon stderr sink must be a regular file")
      fchmodSync(descriptor, 0o600)
      const child = Bun.spawn([process.execPath, input.entryPath, ...input.declarations], {
        cwd: input.toolRoot,
        stdin: "ignore",
        stdout: "ignore",
        stderr: descriptor,
        env: {
          ...Bun.env,
          STORYBOOK_SERVER_PORT: String(input.preferredPort ?? 0),
          STORYBOOK_START_LEASE_PATH: input.startLease.path,
          STORYBOOK_START_LEASE_TOKEN: input.startLease.token,
        },
        detached: true,
      })
      return {
        pid: child.pid,
        get exitCode() { return child.exitCode },
        exited: child.exited,
        stderr: {path},
        kill: signal => child.kill(signal),
        unref: () => child.unref(),
      }
    } finally { closeSync(descriptor) }
  }

  async function waitForRunning(
    signal: AbortSignal,
    toolRoot: string,
    child: SpawnedStorybookDaemon,
    startLease: Readonly<{path: string; token: string}>,
    onProgress?: StorybookControllerContext["onProgress"],
  ): Promise<ExternalStorybookServerRecord> {
    const stderr = captureDaemonStderr(child.stderr, child.exited, progress => {
      writeExternalStorybookStartupProgress(startLease, toolRoot, {phase: String(progress.phase), at: Number(progress.at)})
      return onProgress?.(progress)
    })
    try {
      while (true) {
        stderr.poll()
        signal.throwIfAborted()
        if (child.exitCode !== null) {
          await stderr.completed
          throw new Error(`Storybook daemon exited during startup with code ${child.exitCode}`)
        }
        publishExternalStorybookStartCandidate({
          lease: startLease,
          statePath: externalStorybookServerStatePath(),
          toolRoot,
          childPid: child.pid,
        })
        const inspection = await inspectExternalStorybookServer()
        assertOwnedStorybookState(inspection, toolRoot)
        if (ownedRunningRecord(inspection, toolRoot)) {
          stderr.poll()
          await stderr.finishProgress(signal)
          return inspection.record!
        }
        if (inspection.state === "stale" && !inspection.replaceable) {
          throw new Error(`Storybook daemon published ambiguous state: ${inspection.reason}`)
        }
        await Bun.sleep(50)
      }
    } catch (error) {
      throw withDaemonStderr(error, stderr.tail())
    } finally {
      await stderr.close()
    }
  }

  function captureDaemonStderr(
    source: SpawnedStorybookDaemon["stderr"],
    exited: Promise<number>,
    onProgress?: StorybookControllerContext["onProgress"],
  ): Readonly<{
    completed: Promise<void>
    finishProgress(signal: AbortSignal): Promise<void>
    close(): Promise<void>
    poll(): void
    tail(): string
  }> {
    let output = ""
    let line = ""
    let oversizedLine = false
    let pending = Promise.resolve()
    let progressError: unknown
    let progressFailed = false
    let readyObserved = false
    let closing = false
    const reader = source instanceof ReadableStream ? source.getReader() : undefined
    const descriptor = reader === undefined ? openSync((source as {path: string}).path, constants.O_RDONLY | constants.O_NOFOLLOW) : undefined
    let offset = 0
    const decoder = new TextDecoder()
    const enqueue = (phase: string): void => {
      if (onProgress === undefined || phase === "ready" && readyObserved) return
      if (phase === "ready") readyObserved = true
      const notify = onProgress
      const progress = Object.freeze({phase, at: Date.now()})
      pending = pending.then(() => notify(progress)).catch(error => {
        progressFailed = true
        progressError = error
      })
    }
    const observe = (value: string): void => {
      for (const [index, part] of value.split("\n").entries()) {
        if (index > 0) {
          const phase = !oversizedLine && line.startsWith("Storybook startup: ")
            ? line.slice("Storybook startup: ".length).trim() : ""
          if (phase) enqueue(phase)
          line = ""
          oversizedLine = false
        }
        if (!oversizedLine) {
          line += part
          if (line.length > DAEMON_STDERR_TAIL_LENGTH) {
            line = ""
            oversizedLine = true
          }
        }
      }
    }
    const append = (value: string): void => {
      output = `${output}${value}`.slice(-DAEMON_STDERR_TAIL_LENGTH)
      if (onProgress !== undefined) observe(value)
    }
    const poll = (): void => {
      if (descriptor === undefined || closing) return
      const size = fstatSync(descriptor).size
      const buffer = Buffer.alloc(64 * 1024)
      while (offset < size) {
        const bytes = readSync(descriptor, buffer, 0, Math.min(buffer.length, size - offset), offset)
        if (bytes === 0) break
        offset += bytes
        append(decoder.decode(buffer.subarray(0, bytes), {stream: true}))
      }
    }
    const completed = reader === undefined ? exited.then(() => {
      if (!closing) {
        poll()
        append(decoder.decode())
      }
    }).catch(error => {
      if (!closing) append(`\n[Storybook daemon stderr read failed: ${startupErrorText(error)}]`)
    }) : (async (): Promise<void> => {
      try {
        while (true) {
          const {done, value} = await reader.read()
          if (done) break
          append(decoder.decode(value, {stream: true}))
        }
        append(decoder.decode())
      } catch (error) {
        if (!closing) append(`\n[Storybook daemon stderr read failed: ${startupErrorText(error)}]`)
      } finally {
        reader.releaseLock()
      }
    })()
    return Object.freeze({
      completed,
      poll,
      async close() {
        onProgress = undefined
        closing = true
        // Файл принадлежит диагностике daemon; parent освобождает только свой read descriptor.
        // Custom pipe теряет только pending reader, без cancel writer процесса.
        if (descriptor !== undefined) closeSync(descriptor)
        if (reader !== undefined) {
          reader.releaseLock()
          await completed
        }
      },
      async finishProgress(signal: AbortSignal): Promise<void> {
        signal.throwIfAborted()
        // Parent уже подтвердил owned running record; child может ещё не вывести ready.
        enqueue("ready")
        onProgress = undefined
        let abort: () => void = () => {}
        const cancelled = new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason)
          signal.addEventListener("abort", abort, {once: true})
        })
        try {
          await Promise.race([pending, cancelled])
          signal.throwIfAborted()
          if (progressFailed) throw progressError
        } finally {
          signal.removeEventListener("abort", abort)
        }
      },
      tail: () => output.trim(),
    })
  }

  function withDaemonStderr(error: unknown, stderr: string): Error {
    if (stderr.length === 0) return error instanceof Error ? error : new Error(String(error))
    const message = `${error instanceof Error ? error.message : String(error)}\nStorybook daemon stderr:\n${stderr}`
    return error instanceof DOMException ? new DOMException(message, error.name) : new Error(message)
  }

  function startupErrorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function stopOwnedDaemon(
    record: ExternalStorybookServerRecord,
    signal: AbortSignal,
    statePath: string,
  ): Promise<void> {
    try {
      if (record.controlToken === "") {
        const response = await fetch(new URL("/api/stop", record.origin), {
          method: "POST",
          redirect: "error",
          signal,
        })
        if (!response.ok) throw new Error(`Legacy Storybook stop returned ${response.status}`)
        await response.body?.cancel()
      } else {
        await ServerState.client(record).control(
          "/api/control/stop",
          {confirm: true},
          signal,
        )
      }
    } catch (error) {
      signal.throwIfAborted()
      const current = await inspectExternalStorybookServer(statePath)
      if (current.state === "running" && current.record?.instanceId === record.instanceId) {
        throw new Error("Storybook could not stop its daemon", {
          cause: error,
        })
      }
    }

    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      signal.throwIfAborted()
      const current = await inspectExternalStorybookServer(statePath)
      if (current.state === "stopped" || current.state === "stale" && current.replaceable ||
        current.state === "running" && current.record?.instanceId !== record.instanceId) return
      await Bun.sleep(50)
    }
    throw new DOMException("Storybook daemon stop timed out", "TimeoutError")
  }

  function ownedRunningRecord(
    inspection: Awaited<ReturnType<typeof inspectExternalStorybookServer>>,
    toolRoot: string,
  ): boolean {
    return inspection.state === "running" && inspection.record !== null &&
      inspection.record.toolRoot === toolRoot &&
      inspection.record.controlToken !== ""
  }

  async function migrateLegacyStorybookState(
    statePaths: readonly string[],
    toolRoot: string,
    signal: AbortSignal,
    existing: ExternalStorybookMigrationRecord | null,
  ): Promise<ExternalStorybookMigrationRecord | null> {
    const candidates: Array<Readonly<{
      statePath: string
      inspection: Awaited<ReturnType<typeof inspectExternalStorybookServer>>
      record: ExternalStorybookServerRecord
    }>> = []
    for (const statePath of statePaths) {
      const inspection = await inspectExternalStorybookServer(statePath)
      if (inspection.state === "stopped") continue
      assertOwnedStorybookState(inspection, toolRoot)
      if (inspection.record === null) {
        throw new Error(`Refusing unreadable legacy Storybook state: ${statePath}`)
      }
      if (inspection.state === "stale" && !inspection.replaceable) {
        throw new Error(`Refusing ambiguous legacy Storybook state: ${inspection.reason}`)
      }
      candidates.push(Object.freeze({statePath, inspection, record: inspection.record}))
    }
    if (candidates.length === 0) return existing
    const declarations = mergeDeclarations(
      existing?.declarations ?? [],
      ...candidates.map(({record}) => record.attachedDeclarations),
    )
    const preferred = [...candidates].sort((left, right) =>
      right.record.attachedDeclarations.length - left.record.attachedDeclarations.length ||
      Date.parse(right.record.startedAt) - Date.parse(left.record.startedAt))[0]
    const migration = persistMigrationRecord(
      toolRoot,
      declarations,
      existing?.preferredPort ?? Number(new URL(preferred!.record.origin).port),
    )
    for (const {statePath, inspection, record} of candidates) {
      if (inspection.state === "running") {
        await stopOwnedDaemon(record, signal, statePath)
        continue
      }
      removeReplaceableExternalStorybookState(inspection, statePath)
    }
    return migration
  }

  function mergeDeclarations(...groups: readonly (readonly string[])[]): readonly string[] {
    return Object.freeze([...new Set(groups.flat())].sort())
  }

  function persistMigrationRecord(
    toolRoot: string,
    declarations: readonly string[],
    preferredPort?: number,
  ): ExternalStorybookMigrationRecord {
    return writeExternalStorybookMigrationRecord({
      toolRoot,
      declarations,
      ...(preferredPort === undefined ? {} : {preferredPort}),
    })
  }

  function assertOwnedMigrationRecord(record: ExternalStorybookMigrationRecord | null, toolRoot: string): void {
    if (record !== null && record.toolRoot !== toolRoot) {
      throw new Error(`External Storybook migration belongs to another checkout: ${record.toolRoot}`)
    }
  }

  function assertOwnedStorybookState(
    inspection: Awaited<ReturnType<typeof inspectExternalStorybookServer>>,
    toolRoot: string,
  ): void {
    if (inspection.record !== null && inspection.record.toolRoot !== toolRoot) {
      throw new Error(`External Storybook state belongs to another checkout: ${inspection.record.toolRoot}`)
    }
  }

  async function terminateSpawnedDaemon(child: SpawnedStorybookDaemon): Promise<void> {
    if (child.exitCode !== null) return
    child.kill("SIGTERM")
    await Promise.race([child.exited, Bun.sleep(1_000)])
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
  }

  function canonicalRoots(values: readonly string[]): readonly string[] {
    const roots = values.map((value) => {
      const path = resolve(value)
      if (!existsSync(path)) throw new Error(`Storybook declaration root does not exist: ${value}`)
      return realpathSync(path)
    })
    return Object.freeze([...new Set(roots)])
  }

  function resolveManifestPath(root: string): string {
    const direct = resolve(root)
    return realpathSync(direct.endsWith("/package.json") ? direct : join(direct, "package.json"))
  }

  function canonicalScope(value: string): string {
    if (existsSync(value)) return realpathSync(value)
    return value
  }

  function viewConditionReached(
    value: Readonly<Record<string, unknown>>,
    condition: "ready" | "presented",
    afterRevision: string | undefined,
  ): boolean {
    if (value.ready !== true || condition === "presented" && value.presented !== true) return false
    return typeof value.revision === "string" && value.revision !== afterRevision
  }

  function compactStructuralPath(
    nodes: readonly Readonly<Record<string, unknown>>[],
    node: Readonly<Record<string, unknown>>,
  ): readonly string[] {
    const byId = new Map(nodes.flatMap((candidate) => typeof candidate.id === "string"
      ? [[candidate.id, candidate] as const]
      : []))
    const path: string[] = []
    const seen = new Set<string>()
    let current: Readonly<Record<string, unknown>> | undefined = node
    while (current !== undefined && typeof current.id === "string" && !seen.has(current.id) && path.length < 16) {
      seen.add(current.id)
      path.unshift(current.id)
      current = typeof current.parentId === "string" ? byId.get(current.parentId) : undefined
    }
    return Object.freeze(path)
  }

  function decodeCursor(value: string | undefined): number {
    if (value === undefined) return 0
    const match = /^cursor_([A-Za-z0-9_-]+)$/u.exec(value)
    if (match === null) throw new Error("Invalid Storybook cursor")
    const decoded = Buffer.from(match[1]!, "base64url").toString("utf8")
    if (!/^(?:0|[1-9][0-9]*)$/u.test(decoded)) throw new Error("Invalid Storybook cursor")
    return Number(decoded)
  }

  function encodeCursor(offset: number): string {
    return `cursor_${Buffer.from(String(offset)).toString("base64url")}`
  }

  function publicPackageSnapshot(value: unknown) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    return Object.freeze({
      packageId: record.packageId,
      declarationDigest: record.declarationDigest,
      packageGraphDigest: record.packageGraphDigest,
      candidateRevision: record.candidateRevision,
      builtRevision: record.builtRevision,
      activatingRevision: record.activatingRevision,
      activeRevision: record.activeRevision,
      lastWorkingRevision: record.lastWorkingRevision,
      failedRevision: record.failedRevision,
      buildState: record.buildState,
      diagnostics: sanitizeDiagnostics(record.diagnostics),
      warnings: sanitizeDiagnostics(record.warnings),
      standard: record.standard,
      verification: record.verification && typeof record.verification === "object"
        ? {status: Reflect.get(record.verification, "status")} : null,
      builds: record.builds,
      generation: record.generation,
      requestedGeneration: record.requestedGeneration,
      completedGeneration: record.completedGeneration,
      subscribers: record.subscribers,
      pendingOperationId: record.pendingOperationId,
      lastBuildReason: record.lastBuildReason,
      lastQueueDurationMs: record.lastQueueDurationMs,
      lastExecutionDurationMs: record.lastExecutionDurationMs,
      cacheOutcome: record.cacheOutcome,
    })
  }

  function publicOriginIdentity(record: ExternalStorybookServerRecord): string {
    return `storybook-origin-v1_${createHmac("sha256", record.controlToken)
      .update(`${record.instanceId}\0${record.origin}`)
      .digest("base64url")}`
  }

  function sanitizeDiagnostics(value: unknown) {
    if (!Array.isArray(value)) return Object.freeze([])
    return Object.freeze(value.slice(0, 100).map((candidate) => {
      if (candidate === null || typeof candidate !== "object") return {phase: "unknown", message: String(candidate)}
      const record = candidate as Record<string, unknown>
      return Object.freeze({phase: record.phase, message: String(record.message ?? "").slice(0, 4_096)})
    }))
  }

  function publicRoot(value: unknown) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    return Object.freeze({
      rootKind: record.rootKind,
      canonicalId: record.canonicalId,
      digest: record.digest,
    })
  }

  function compactGraphNode(node: Readonly<Record<string, unknown>>) {
    return Object.freeze({
      nodeId: node.id,
      kind: node.kind,
      packageId: node.packageId,
      label: node.label,
      parentId: node.parentId,
      route: node.routePath,
      childCount: Array.isArray(node.childIds) ? node.childIds.length : 0,
    })
  }

  function jsonResource(uri: string, value: unknown): StorybookResourceResult {
    return Object.freeze({
      status: "success",
      uri,
      mimeType: "application/json",
      text: JSON.stringify(value),
    })
  }
  return new ExternalStorybookController(options)
}
