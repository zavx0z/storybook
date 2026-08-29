import {createHmac} from "node:crypto"
import {existsSync, realpathSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join, resolve} from "node:path"
import {
  StorybookBrowserController,
} from "./browser-control/controller.ts"
import {StorybookCaptureStore} from "./browser-control/capture-store.ts"
import {
  type ExternalStorybookController as ExternalStorybookControllerContract,
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
} from "./browser-control/types.ts"
import {ExternalStorybookControlClient} from "./control-client.ts"
import {externalStorybookImplementationDigest} from "./implementation-digest.ts"
import {
  acquireExternalStorybookStartLease,
  clearExternalStorybookMigrationRecord,
  externalStorybookLegacyStatePaths,
  externalStorybookStateRoot,
  externalStorybookServerStatePath,
  inspectExternalStorybookServer,
  publishExternalStorybookStartCandidate,
  readExternalStorybookMigrationRecord,
  removeReplaceableExternalStorybookState,
  writeExternalStorybookMigrationRecord,
  type ExternalStorybookMigrationRecord,
  type ExternalStorybookServerRecord,
} from "./server-state.ts"

type ClientSnapshot = Readonly<{
  graphDigest: string
  rootIds: readonly string[]
  nodes: readonly Readonly<Record<string, unknown>>[]
  packages: readonly Readonly<Record<string, unknown>>[]
}>

type SpawnedStorybookDaemon = Bun.Subprocess<"ignore", "ignore", "pipe">

export type CreateExternalStorybookControllerOptions = Readonly<{
  daemonEntryPath?: string
  toolRoot?: string
  captureRoot?: string
  legacyStatePaths?: readonly string[]
  spawnDaemon?: (input: Readonly<{
    entryPath: string
    toolRoot: string
    declarations: readonly string[]
    preferredPort?: number
    startLease: Readonly<{path: string; token: string}>
  }>) => SpawnedStorybookDaemon
}>

/** One typed application service shared by human CLI and Storybook MCP. */
export class ExternalStorybookController implements ExternalStorybookControllerContract {
  readonly #toolRoot: string
  readonly #daemonEntryPath: string
  readonly #spawnDaemon: (input: Readonly<{
    entryPath: string
    toolRoot: string
    declarations: readonly string[]
    preferredPort?: number
    startLease: Readonly<{path: string; token: string}>
  }>) => SpawnedStorybookDaemon
  readonly #captureStore: StorybookCaptureStore
  readonly #legacyStatePaths: readonly string[]
  #browserInstanceId: string | null = null
  #browser: StorybookBrowserController | null = null

  constructor(options: CreateExternalStorybookControllerOptions = {}) {
    this.#toolRoot = realpathSync(options.toolRoot ?? fileURLToPath(new URL("../../", import.meta.url)))
    this.#daemonEntryPath = realpathSync(options.daemonEntryPath ?? fileURLToPath(
      new URL("../../scripts/storybook-daemon.ts", import.meta.url),
    ))
    this.#spawnDaemon = options.spawnDaemon ?? spawnCanonicalDaemon
    this.#captureStore = new StorybookCaptureStore({
      root: resolve(options.captureRoot ?? join(externalStorybookStateRoot(), "captures")),
    })
    this.#legacyStatePaths = Object.freeze([...(options.legacyStatePaths ?? externalStorybookLegacyStatePaths())])
  }

  async ensure(input: StorybookEnsureInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
    const roots = canonicalRoots(input.roots ?? Object.freeze([]))
    const record = await this.#ensureRunning(context.signal)
    const client = new ExternalStorybookControlClient(record)
    if (roots.length > 0) {
      const status = await client.read("/api/control/status", context.signal)
      const attached = new Set(Array.isArray(status.entries) ? status.entries.flatMap((candidate) =>
        candidate !== null && typeof candidate === "object" && typeof (candidate as Record<string, unknown>).declarationPath === "string"
          ? [(candidate as Record<string, unknown>).declarationPath as string]
          : []) : [])
      const missing = roots.filter((root) => !attached.has(resolveManifestPath(root)))
      if (missing.length > 0) await client.control("/api/control/attach", {roots: missing}, context.signal)
    }
    return this.#statusResult(record, false, context.signal)
  }

  async status(input: StorybookStatusInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
    const inspection = await inspectExternalStorybookServer()
    assertOwnedStorybookState(inspection, this.#toolRoot)
    if (inspection.state !== "running" || inspection.record === null) {
      return Object.freeze({status: "success", server: inspection.state, reason: inspection.reason})
    }
    if (inspection.record.implementationDigest !== externalStorybookImplementationDigest(this.#toolRoot)) {
      return Object.freeze({
        status: "success",
        server: "stale",
        reason: "Storybook implementation changed; storybook_ensure is required",
      })
    }
    return this.#statusResult(inspection.record, input.includeViews === true, context.signal, input.scope)
  }

  async attach(input: StorybookAttachInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
    return this.ensure({schemaVersion: 1, roots: [input.root]}, context)
  }

  async detach(input: StorybookDetachInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
    const record = await this.#requireRunning()
    const client = new ExternalStorybookControlClient(record)
    await client.control("/api/control/detach", {scopeId: input.scopeId}, context.signal)
    const snapshot = await this.#clientSnapshot(record, context.signal)
    const packageIds = new Set(snapshot.packages.map((candidate) => String(candidate.packageId)))
    const browser = this.#browserFor(record)
    for (const view of await browser.synchronize(record.origin, context.signal)) {
      if (!packageIds.has(view.packageId)) await browser.close(view.viewId, context.signal)
    }
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
    const client = new ExternalStorybookControlClient(record)
    const route = input.route ?? ""
    const snapshot = await this.#clientSnapshot(record, context.signal)
    const node = exactRouteNode(snapshot, input.packageId, route)
    const checked = await client.control("/api/control/check", {scope: input.packageId, live: false}, context.signal)
    const packageState = Array.isArray(checked.packages)
      ? checked.packages.find((candidate) => candidate !== null && typeof candidate === "object" &&
        (candidate as Record<string, unknown>).packageId === input.packageId) as Record<string, unknown> | undefined
      : undefined
    const expectedRevision = typeof packageState?.builtRevision === "string" ? packageState.builtRevision : undefined
    const openInput = {
      origin: record.origin,
      packageId: input.packageId,
      route,
      url: new URL(String(node.urlPath), record.origin).href,
      ...(expectedRevision === undefined ? {} : {expectedRevision}),
    }
    let opened
    try {
      opened = await this.#browserFor(record).open(openInput, context.signal)
    } catch (error) {
      if (expectedRevision === undefined || !(error instanceof Error) ||
        !error.message.includes("view revision mismatch")) throw error
      opened = await this.#browserFor(record).open({
        origin: record.origin,
        packageId: input.packageId,
        route,
        url: new URL(String(node.urlPath), record.origin).href,
      }, context.signal)
    }
    const candidateMatches = expectedRevision === undefined || opened.identity.revision === expectedRevision
    const ok = checked.ok === true && candidateMatches && opened.identity.ready
    const projectedPackage = publicPackageSnapshot(packageState)
    return Object.freeze({
      status: ok ? "success" : "failed",
      viewId: opened.view.viewId,
      packageId: opened.identity.packageId,
      route: opened.identity.route,
      graphDigest: opened.identity.graphDigest,
      revision: opened.identity.revision,
      state: opened.identity.ready ? "ready" : "error",
      ready: opened.identity.ready,
      presented: opened.identity.presented,
      reused: opened.reused,
      ...(expectedRevision === undefined ? {} : {candidateRevision: expectedRevision}),
      workingFallback: opened.identity.ready && !candidateMatches,
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
    const client = new ExternalStorybookControlClient(record)
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
    const browser = this.#browserFor(record)
    await browser.synchronize(record.origin, signal)
    const view = browser.views().find(({viewId}) => viewId === input.viewId)
    if (view === undefined) throw new Error(`Unknown Storybook view: ${input.viewId}`)
    if (input.packageId !== undefined && input.packageId !== view.packageId) {
      throw new Error(`Storybook wait view belongs to ${view.packageId}, not ${input.packageId}`)
    }
    let inspected: Readonly<Record<string, unknown>> | null = null
    try {
      inspected = await browser.inspect(input.viewId, {include: ["state"]}, signal)
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
      view,
    })
    const client = new ExternalStorybookControlClient(record)
    const waited = await client.control("/api/control/wait", {
      packageId: view.packageId,
      viewId: input.viewId,
      afterRevision: input.afterRevision ?? (typeof inspected?.revision === "string" ? inspected.revision : null),
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
        view,
      })
    }
    const snapshot = await this.#clientSnapshot(record, signal)
    const node = exactRouteNode(snapshot, view.packageId, view.route)
    const opened = await browser.open({
      origin: record.origin,
      packageId: view.packageId,
      route: view.route,
      url: new URL(String(node.urlPath), record.origin).href,
      timeoutMs: Math.max(100, deadline - Date.now()),
      expectedRevision: waited.currentRevision,
    }, signal)
    const reached = opened.identity.ready &&
      (input.condition === "ready" || opened.identity.presented) &&
      opened.identity.revision !== input.afterRevision
    return Object.freeze({
      status: reached ? "success" : "timeout",
      condition: input.condition,
      reached,
      previousRevision: input.afterRevision ?? null,
      currentRevision: opened.identity.revision,
      view: Object.freeze({...opened.view, ...opened.identity}),
    })
  }

  async inspect(input: StorybookInspectInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
    const record = await this.#requireRunning()
    const browser = this.#browserFor(record)
    await browser.synchronize(record.origin, context.signal)
    const result = await browser.inspect(input.viewId, {
      ...(input.include === undefined ? {} : {include: input.include}),
      ...(input.maxDepth === undefined ? {} : {maxDepth: input.maxDepth}),
      ...(input.limit === undefined ? {} : {limit: input.limit}),
      ...(input.cursor === undefined ? {} : {cursor: input.cursor}),
    }, context.signal)
    return Object.freeze({status: "success", ...result})
  }

  async interact(input: StorybookInteractInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
    const record = await this.#requireRunning()
    const browser = this.#browserFor(record)
    await browser.synchronize(record.origin, context.signal)
    const result = await browser.interact(input, context.signal)
    return Object.freeze({status: "success", ...result})
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
    } else {
      await this.#browserFor(record).synchronize(record.origin, context.signal)
    }
    const result = await this.#browserFor(record).capture({...input, viewId}, context.signal)
    return Object.freeze({status: "success", ...result})
  }

  async check(input: StorybookCheckInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
    const timeoutSignal = AbortSignal.timeout(input.timeoutMs ?? 30_000)
    const operationContext = Object.freeze({signal: AbortSignal.any([context.signal, timeoutSignal])})
    const pathScope = existsSync(input.scope) ? realpathSync(input.scope) : null
    if (pathScope !== null) {
      await this.ensure({schemaVersion: 1, roots: [pathScope]}, operationContext)
    }
    const record = pathScope === null
      ? await this.#ensureRunning(operationContext.signal)
      : await this.#requireRunning()
    const client = new ExternalStorybookControlClient(record)
    const result = await client.control("/api/control/check", {
      scope: pathScope ?? canonicalScope(input.scope),
      live: input.live ?? false,
    }, operationContext.signal)
    let publicPackages = Array.isArray(result.packages)
      ? result.packages.map(publicPackageSnapshot).filter(Boolean)
      : []
    if (input.live === true && Array.isArray(result.packages)) {
      const views = []
      let timedOut = false
      for (const candidate of result.packages) {
        if (candidate === null || typeof candidate !== "object") continue
        const packageRecord = candidate as Record<string, unknown>
        const packageId = String(packageRecord.packageId)
        const expectedRevision = typeof packageRecord.builtRevision === "string"
          ? packageRecord.builtRevision
          : typeof packageRecord.activeRevision === "string"
            ? packageRecord.activeRevision
            : null
        try {
          const opened = await this.open({schemaVersion: 1, packageId, route: ""}, operationContext)
          views.push(Object.freeze({
            ...opened,
            expectedRevision,
            revisionMatches: expectedRevision !== null && opened.revision === expectedRevision,
          }))
        } catch (error) {
          if (operationContext.signal.aborted) {
            if (context.signal.aborted) throw context.signal.reason ?? error
            timedOut = true
            break
          }
          views.push(Object.freeze({
            status: "failed",
            packageId,
            error: Object.freeze({
              code: error instanceof Error ? error.name : "Error",
              message: error instanceof Error ? error.message : String(error),
            }),
          }))
        }
      }
      if (!timedOut) {
        const refreshed = await client.read("/api/control/status", operationContext.signal)
        const checkedPackageIds = new Set(result.packages.flatMap((candidate) =>
          candidate !== null && typeof candidate === "object" &&
          typeof (candidate as Record<string, unknown>).packageId === "string"
            ? [(candidate as Record<string, unknown>).packageId as string]
            : []))
        publicPackages = Array.isArray(refreshed.packages)
          ? refreshed.packages
            .filter((candidate) => candidate !== null && typeof candidate === "object" &&
              checkedPackageIds.has(String((candidate as Record<string, unknown>).packageId)))
            .map(publicPackageSnapshot).filter(Boolean)
          : publicPackages
      }
      const ok = !timedOut && result.ok === true && views.every((view) => {
        const value = view as Readonly<Record<string, unknown>>
        return value.status === "success" && value.ready === true && value.revisionMatches === true
      })
      return Object.freeze({
        status: timedOut ? "timeout" : ok ? "success" : "failed",
        ok,
        graphDigest: result.graphDigest,
        packages: publicPackages,
        views,
      })
    }
    return Object.freeze({
      status: result.ok === true ? "success" : "failed",
      ok: result.ok === true,
      graphDigest: result.graphDigest,
      packages: publicPackages,
    })
  }

  async close(input: StorybookCloseInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
    const record = await this.#requireRunning()
    const browser = this.#browserFor(record)
    await browser.synchronize(record.origin, context.signal)
    return Object.freeze({status: "success", ...await browser.close(input.viewId, context.signal)})
  }

  async stop(input: StorybookStopInput, context: StorybookControllerContext): Promise<StorybookControllerResult> {
    if (input.confirm !== true) throw new Error("Storybook stop requires confirm: true")
    const inspection = await inspectExternalStorybookServer()
    if (inspection.state !== "running" || inspection.record === null) {
      throw new Error("External Storybook server is not running")
    }
    assertOwnedStorybookState(inspection, this.#toolRoot)
    const record = inspection.record
    await stopMismatchedDaemon(record, context.signal, externalStorybookServerStatePath())
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
      const browser = this.#browserFor(record)
      await browser.synchronize(record.origin, context.signal)
      return jsonResource(uri, await browser.inspect(viewId, {include: ["state", "diagnostics"], limit: 40}, context.signal))
    }
    if (parsed.hostname === "captures") {
      const captureId = parsed.pathname.slice(1)
      const capture = this.#captureStore.read(captureId)
      return Object.freeze({
        status: "success",
        uri,
        mimeType: "image/png",
        blob: Buffer.from(capture.png).toString("base64"),
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
    const client = new ExternalStorybookControlClient(record)
    const value = await client.read("/api/control/status", signal)
    const packages = Array.isArray(value.packages)
      ? value.packages.filter((candidate) => scope === undefined ||
        candidate !== null && typeof candidate === "object" && (candidate as Record<string, unknown>).packageId === scope)
        .map(publicPackageSnapshot)
      : []
    const views = includeViews
      ? await this.#browserFor(record).synchronize(record.origin, signal)
      : undefined
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
      ...(views === undefined ? {} : {views}),
    })
  }

  async #clientSnapshot(record: ExternalStorybookServerRecord, signal: AbortSignal): Promise<ClientSnapshot> {
    const value = await new ExternalStorybookControlClient(record).read("/api/client", signal)
    if (typeof value.graphDigest !== "string" || !Array.isArray(value.rootIds) ||
      !Array.isArray(value.nodes) || !Array.isArray(value.packages)) {
      throw new Error("External Storybook client snapshot is invalid")
    }
    return value as unknown as ClientSnapshot
  }

  async #ensureRunning(signal: AbortSignal): Promise<ExternalStorybookServerRecord> {
    let implementationDigest = externalStorybookImplementationDigest(this.#toolRoot)
    let inspection = await inspectExternalStorybookServer()
    assertOwnedStorybookState(inspection, this.#toolRoot)
    let migration = readExternalStorybookMigrationRecord()
    assertOwnedMigrationRecord(migration, this.#toolRoot)
    const legacyStatePaths = this.#legacyStatePaths
    if (compatibleRunningRecord(inspection, implementationDigest, this.#toolRoot) &&
      !legacyStatePaths.some(existsSync) && migration === null) return inspection.record!
    let lease: ReturnType<typeof acquireExternalStorybookStartLease> | null = null
    try {
      const leaseDeadline = Date.now() + 20_000
      while (lease === null) {
        signal.throwIfAborted()
        try {
          lease = acquireExternalStorybookStartLease()
        } catch (error) {
          if (!String(error).includes("start is already in progress")) throw error
          implementationDigest = externalStorybookImplementationDigest(this.#toolRoot)
          inspection = await inspectExternalStorybookServer()
          assertOwnedStorybookState(inspection, this.#toolRoot)
          migration = readExternalStorybookMigrationRecord()
          assertOwnedMigrationRecord(migration, this.#toolRoot)
          if (compatibleRunningRecord(inspection, implementationDigest, this.#toolRoot) &&
            !legacyStatePaths.some(existsSync) && migration === null) return inspection.record!
          if (Date.now() >= leaseDeadline) {
            throw new DOMException("Storybook server start coordination timed out", "TimeoutError")
          }
          await Bun.sleep(50)
        }
      }
      implementationDigest = externalStorybookImplementationDigest(this.#toolRoot)
      migration = await migrateLegacyStorybookState(legacyStatePaths, this.#toolRoot, signal, migration)
      inspection = await inspectExternalStorybookServer()
      assertOwnedStorybookState(inspection, this.#toolRoot)
      if (compatibleRunningRecord(inspection, implementationDigest, this.#toolRoot)) {
        const record = await attachMigratedDeclarations(inspection.record!, migration?.declarations ?? [], signal)
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
        await stopMismatchedDaemon(inspection.record, signal, externalStorybookServerStatePath())
        inspection = await inspectExternalStorybookServer()
        assertOwnedStorybookState(inspection, this.#toolRoot)
        if (compatibleRunningRecord(inspection, implementationDigest, this.#toolRoot)) {
          const record = await attachMigratedDeclarations(inspection.record!, declarations, signal)
          if (migration !== null) clearExternalStorybookMigrationRecord(this.#toolRoot)
          return record
        }
      }
      if (inspection.state === "stale") {
        if (!inspection.replaceable) throw new Error(`Refusing ambiguous Storybook stale state: ${inspection.reason}`)
        removeReplaceableExternalStorybookState(inspection)
      }
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
          implementationDigest,
          this.#toolRoot,
          child,
          Object.freeze({path: lease.path, token: lease.token}),
        )
        child.unref()
        if (migration !== null) clearExternalStorybookMigrationRecord(this.#toolRoot)
        return record
      } catch (error) {
        const current = await inspectExternalStorybookServer()
        const currentDigest = externalStorybookImplementationDigest(this.#toolRoot)
        if (current.state === "running" && current.record?.pid === child.pid &&
          compatibleRunningRecord(current, currentDigest, this.#toolRoot)) {
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
    if (inspection.record.implementationDigest !== externalStorybookImplementationDigest(this.#toolRoot)) {
      throw new Error("External Storybook implementation changed; call storybook_ensure")
    }
    return inspection.record
  }

  #browserFor(record: ExternalStorybookServerRecord): StorybookBrowserController {
    if (this.#browser !== null && this.#browserInstanceId === record.instanceId) return this.#browser
    this.#browser = new StorybookBrowserController({
      captures: this.#captureStore,
    })
    this.#browserInstanceId = record.instanceId
    return this.#browser
  }
}

export function createExternalStorybookController(
  options: CreateExternalStorybookControllerOptions = {},
): ExternalStorybookController {
  return new ExternalStorybookController(options)
}

function spawnCanonicalDaemon(input: Readonly<{
  entryPath: string
  toolRoot: string
  declarations: readonly string[]
  preferredPort?: number
  startLease: Readonly<{path: string; token: string}>
}>): SpawnedStorybookDaemon {
  const child = Bun.spawn([process.execPath, input.entryPath, ...input.declarations], {
    cwd: input.toolRoot,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...Bun.env,
      STORYBOOK_SERVER_PORT: String(input.preferredPort ?? 0),
      STORYBOOK_START_LEASE_PATH: input.startLease.path,
      STORYBOOK_START_LEASE_TOKEN: input.startLease.token,
    },
    detached: true,
  })
  return child
}

async function waitForRunning(
  signal: AbortSignal,
  implementationDigest: string,
  toolRoot: string,
  child: SpawnedStorybookDaemon,
  startLease: Readonly<{path: string; token: string}>,
): Promise<ExternalStorybookServerRecord> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    if (child.exitCode !== null) {
      const stderr = (await new Response(child.stderr).text()).trim()
      throw new Error(stderr.length === 0
        ? `Storybook daemon exited during startup with code ${child.exitCode}`
        : `Storybook daemon exited during startup: ${stderr.slice(0, 4_096)}`)
    }
    publishExternalStorybookStartCandidate({
      lease: startLease,
      statePath: externalStorybookServerStatePath(),
      toolRoot,
      childPid: child.pid,
    })
    const inspection = await inspectExternalStorybookServer()
    assertOwnedStorybookState(inspection, toolRoot)
    if (compatibleRunningRecord(inspection, implementationDigest, toolRoot)) return inspection.record!
    if (inspection.state === "running" && inspection.record !== null) {
      const currentDigest = externalStorybookImplementationDigest(toolRoot)
      if (compatibleRunningRecord(inspection, currentDigest, toolRoot)) return inspection.record
      if (inspection.record.pid === child.pid) {
        throw new Error("Storybook implementation changed while the daemon was starting")
      }
    }
    if (inspection.state === "stale" && !inspection.replaceable) {
      throw new Error(`Storybook daemon published ambiguous state: ${inspection.reason}`)
    }
    await Bun.sleep(50)
  }
  throw new DOMException("Storybook server start timed out", "TimeoutError")
}

async function stopMismatchedDaemon(
  record: ExternalStorybookServerRecord,
  signal: AbortSignal,
  statePath: string,
): Promise<void> {
  try {
    if (record.implementationDigest === undefined) {
      const response = await fetch(new URL("/api/stop", record.origin), {
        method: "POST",
        redirect: "error",
        signal,
      })
      if (!response.ok) throw new Error(`Legacy Storybook stop returned ${response.status}`)
      await response.body?.cancel()
    } else {
      await new ExternalStorybookControlClient(record).control(
        "/api/control/stop",
        {confirm: true},
        signal,
      )
    }
  } catch (error) {
    const current = await inspectExternalStorybookServer(statePath)
    if (current.state === "running" && current.record?.instanceId === record.instanceId) {
      throw new Error("Storybook daemon implementation upgrade could not stop the previous instance", {
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
  throw new DOMException("Storybook daemon implementation upgrade timed out", "TimeoutError")
}

function compatibleRunningRecord(
  inspection: Awaited<ReturnType<typeof inspectExternalStorybookServer>>,
  implementationDigest: string,
  toolRoot: string,
): boolean {
  return inspection.state === "running" && inspection.record !== null &&
    inspection.record.toolRoot === toolRoot &&
    inspection.record.implementationDigest === implementationDigest
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
      await stopMismatchedDaemon(record, signal, statePath)
      continue
    }
    removeReplaceableExternalStorybookState(inspection, statePath)
  }
  return migration
}

async function attachMigratedDeclarations(
  record: ExternalStorybookServerRecord,
  declarations: readonly string[],
  signal: AbortSignal,
): Promise<ExternalStorybookServerRecord> {
  if (declarations.length === 0) return record
  const client = new ExternalStorybookControlClient(record)
  const status = await client.read("/api/control/status", signal)
  const attached = new Set(Array.isArray(status.entries) ? status.entries.flatMap((candidate) =>
    candidate !== null && typeof candidate === "object" &&
      typeof (candidate as Record<string, unknown>).declarationPath === "string"
      ? [(candidate as Record<string, unknown>).declarationPath as string]
      : []) : [])
  const missing = declarations.filter((path) => !attached.has(path))
  if (missing.length > 0) await client.control("/api/control/attach", {roots: missing}, signal)
  return record
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
  if (direct.endsWith("/.storybook/manifest.json")) return realpathSync(direct)
  return realpathSync(join(direct, ".storybook", "manifest.json"))
}

function canonicalScope(value: string): string {
  if (existsSync(value)) return realpathSync(value)
  return value
}

function exactRouteNode(snapshot: ClientSnapshot, packageId: string, route: string): Readonly<Record<string, unknown>> {
  const matches = snapshot.nodes.filter((node) => node.packageId === packageId && node.routePath === route)
  if (matches.length === 0) throw new Error(`Unknown Storybook route: ${packageId}:${route}`)
  if (matches.length > 1) throw new Error(`Ambiguous Storybook route: ${packageId}:${route}`)
  return matches[0]!
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
    builds: record.builds,
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
