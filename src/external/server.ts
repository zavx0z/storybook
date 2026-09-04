import {randomBytes, randomUUID} from "node:crypto"
import {
  createStorybookBrowserLifecycle,
  type StorybookBrowserLifecycle,
} from "@zavx0z/storybook-browser-lifecycle/service"
import type {
  StorybookBrowserCaptureInput,
  StorybookBrowserInteractInput,
} from "@zavx0z/storybook-browser-lifecycle/contract"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs"
import {basename, dirname, extname, isAbsolute, join, relative, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"
import {createExternalStorybookClientSnapshot} from "./browser/client-protocol.ts"
import {mergeStorybookAuthorStyleSheets} from "./author-style-sheets.ts"
import {StorybookDependencyWatchCoordinator, StorybookDirtyRefreshCoordinator} from "./dependency-watch.ts"
import {assertExternalStorybookStartLease, externalStorybookArtifactRoot, createExternalStorybookServerRecord, externalStorybookServerStatePath, readExternalStorybookServerRecord, writeExternalStorybookServerRecord, writeExternalStorybookStartCandidate, type ExternalStorybookServerRecord} from "./server-state.ts"
import {ExternalStorybookRegistry, type ExternalStorybookRegistrySnapshot} from "./registry.ts"
import {createStorybookPackageRevisionBuilder} from "./package-build.ts"
import {createStorybookPackageCompilerPlugins} from "./compiler.ts"
import type {StorybookPackageRevisionAuthorStyleSheet} from "./package-revision.ts"
import {ExternalStorybookSessionManager} from "./session-manager.ts"
import {externalStorybookNode, resolveExternalStorybookRoute} from "./graph.ts"
import {storybookDiagnostic, type StorybookPackageEvent} from "./package-session.ts"
import {createExternalStorybookResourceAllowList} from "./resource-allowlist.ts"
import {StorybookEventHub} from "./events.ts"
import {externalStorybookImplementationDigest} from "./implementation-digest.ts"
import {externalStorybookPageTitle} from "./page-title.ts"
import {
  ExternalStorybookSecurityError,
  assertExternalStorybookControlRequest,
  assertExternalStorybookRequestHost,
  assertExternalStorybookRequestOrigin,
} from "./security.ts"
import {STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS} from "./timing.ts"

const STORYBOOK_CONTROL_BODY_MAX_BYTES = 65_536
const STORYBOOK_WEBSOCKET_MESSAGE_MAX_BYTES = 8_192
const STORYBOOK_BROWSER_SESSION_TTL_MS = 120_000
const STORYBOOK_BROWSER_SESSION_MAX_ENTRIES = 1_024

type StorybookHtmlAuthorStyleSheet = StorybookPackageRevisionAuthorStyleSheet & Readonly<{
  href: string
}>

type StorybookWebSocketData = {
  subscriptions: Set<string>
  unsubscribers: Map<string, () => void>
  grant: StorybookBrowserSessionGrant
  sessionToken: string
}

type StorybookBrowserSessionGrant = Readonly<{
  kind: "registry" | "package"
  packageId: string | null
  revision: string | null
  viewId: string | null
  activationId: string | null
  packageGraphDigest: string | null
  allowedTopics: ReadonlySet<string>
  expiresAt: number
  release(): void
}>

export type ExternalStorybookServerOptions = Readonly<{
  declarations?: readonly string[]
  hostname?: string
  port?: number
  toolRoot?: string
  statePath?: string
  artifactRoot?: string
  landingEntryPath?: string
  fallbackEntryPath?: string
  packageBrowserEntryPath?: string
  browserLifecycle?: StorybookBrowserLifecycle
  browserStateRoot?: string
  captureRoot?: string
  writeServerRecord?: typeof writeExternalStorybookServerRecord
  startLease?: Readonly<{path: string; token: string}>
}>

export type ExternalStorybookRunningServer = Readonly<{
  origin: string
  record: ExternalStorybookServerRecord
  registry: ExternalStorybookRegistry
  sessions: ExternalStorybookSessionManager
  watch: StorybookDependencyWatchCoordinator
  browserLifecycle: StorybookBrowserLifecycle
  server: Bun.Server<StorybookWebSocketData>
  stopped: Promise<void>
  stop(): Promise<void>
}>

/** Starts the one external Storybook HTTP/WebSocket process on an automatic port. */
export async function startExternalStorybookServer(
  options: ExternalStorybookServerOptions = {},
): Promise<ExternalStorybookRunningServer> {
  const toolRoot = realpathSync(options.toolRoot ?? fileURLToPath(new URL("../../", import.meta.url)))
  const implementationDigest = externalStorybookImplementationDigest(toolRoot)
  const statePath = resolve(options.statePath ?? externalStorybookServerStatePath())
  const artifactRoot = resolve(options.artifactRoot ?? externalStorybookArtifactRoot())
  const writeServerRecord = options.writeServerRecord ?? writeExternalStorybookServerRecord
  const browserLifecycle = options.browserLifecycle ?? createStorybookBrowserLifecycle({
    stateRoot: resolve(options.browserStateRoot ?? join(dirname(statePath), "browser")),
    captureRoot: resolve(options.captureRoot ?? join(dirname(statePath), "captures")),
  })
  mkdirSync(artifactRoot, {recursive: true, mode: 0o700})
  chmodSync(artifactRoot, 0o700)
  const registry = new ExternalStorybookRegistry()
  if ((options.declarations?.length ?? 0) > 0) await registry.attachMany(options.declarations!)
  const clients = new Set<Bun.ServerWebSocket<StorybookWebSocketData>>()
  const watch = new StorybookDependencyWatchCoordinator()
  let serverRecord!: ExternalStorybookServerRecord
  let serverRecordCreated = false
  let stoppedResolve: () => void
  const stopped = new Promise<void>((resolvePromise) => {
    stoppedResolve = resolvePromise
  })
  let closing = false
  let closePromise: Promise<void> | null = null
  let sharedAssets: Promise<SharedBrowserAssets> | null = null
  const browserSessions = new StorybookBrowserSessionRegistry()
  const eventHub = new StorybookEventHub<StorybookPackageEvent | RegistryEvent>()

  const publish = (event: StorybookPackageEvent | RegistryEvent): number => {
    eventHub.publish(event)
    const browserEvent = event.type === "package.failed"
      ? sanitizePackageFailure(event, registry, () => sessions.snapshots())
      : event
    const payload = JSON.stringify(browserEvent)
    let delivered = 0
    for (const client of clients) {
      if (!matchesSubscription(client.data.subscriptions, event)) continue
      try {
        client.send(payload)
        delivered += 1
      } catch (error) {
        console.error("External Storybook WebSocket publication failed", error)
      }
    }
    return delivered
  }
  const sessions = new ExternalStorybookSessionManager({
    artifactRoot,
    buildRevision: createStorybookPackageRevisionBuilder({
      ...(options.packageBrowserEntryPath === undefined
        ? {}
        : {browserEntryPath: options.packageBrowserEntryPath}),
    }),
    watch,
    publish,
  })
  sessions.sync(registry.packageDescriptors())

  const refreshStructuralWatch = (): void => {
    const snapshot = registry.snapshot()
    watch.replace("__registry__", externalStorybookStructuralWatchPaths(snapshot), () => {
      void structuralRefresh.request()
    })
  }

  const commitRegistry = (snapshot: ExternalStorybookRegistrySnapshot): void => {
    const nextRecord = Object.freeze({
      ...serverRecord,
      attachedDeclarations: Object.freeze(snapshot.entries.map(({declarationPath}) => declarationPath)),
    })
    writeServerRecord(statePath, nextRecord)
    refreshStructuralWatch()
    sessions.sync(registry.packageDescriptors())
    serverRecord = nextRecord
    publish(Object.freeze({
      type: "registry.updated",
      revision: snapshot.revision,
      graphDigest: snapshot.graph.digest,
    }))
  }

  const mutateRegistry = async (
    operation: () => Promise<ExternalStorybookRegistrySnapshot>,
  ): Promise<ExternalStorybookRegistrySnapshot> => {
    const before = registry.snapshot()
    const beforeRecord = serverRecord
    try {
      const snapshot = await operation()
      if (snapshot.revision !== before.revision) commitRegistry(snapshot)
      return snapshot
    } catch (error) {
      if (registry.snapshot().revision !== before.revision || registry.snapshot().graph !== before.graph) {
        registry.restore(before)
        try {
          writeServerRecord(statePath, beforeRecord)
          refreshStructuralWatch()
          sessions.sync(registry.packageDescriptors())
          serverRecord = beforeRecord
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "External Storybook registry rollback failed")
        }
      }
      throw error
    }
  }

  const openPackageView = async (
    input: Readonly<{
      packageId: string
      route: string
      timeoutMs?: number
      foreground?: boolean
    }>,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> => {
    await mutateRegistry(() => registry.refresh())
    const graph = registry.snapshot().graph
    const resolvedRoute = resolveExternalStorybookRoute(
      graph,
      input.packageId,
      input.route,
    )
    const packageNode = graph.nodes.find((node) =>
      node.kind === "package" && node.packageId === input.packageId)
    if (packageNode === undefined) throw new Error(`Unknown Storybook package: ${input.packageId}`)
    sessions.retryFailed(input.packageId)
    const packageState = await sessions.ensure(input.packageId)
    const expectedRevision = packageState.builtRevision ?? undefined
    const openInput = {
      origin: server.url.origin,
      packageId: input.packageId,
      route: input.route,
      url: new URL(resolvedRoute.urlPath, server.url).href,
      packageLabel: externalStorybookPageTitle(packageNode.packageId, packageNode.label),
      ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
      ...(expectedRevision === undefined ? {} : {expectedRevision}),
      ...(input.foreground === undefined ? {} : {foreground: input.foreground}),
    }
    let opened
    try {
      opened = await browserLifecycle.openPackage(openInput, signal)
    } catch (error) {
      if (expectedRevision === undefined || !(error instanceof Error) ||
        !error.message.includes("view revision mismatch")) throw error
      opened = await browserLifecycle.openPackage({
        origin: server.url.origin,
        packageId: input.packageId,
        route: input.route,
        url: new URL(resolvedRoute.urlPath, server.url).href,
        packageLabel: externalStorybookPageTitle(packageNode.packageId, packageNode.label),
        ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
        ...(input.foreground === undefined ? {} : {foreground: input.foreground}),
      }, signal)
    }
    const candidateMatches = expectedRevision === undefined || opened.identity.revision === expectedRevision
    return Object.freeze({
      ok: candidateMatches && opened.identity.ready,
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
      package: sessions.session(input.packageId).snapshot(),
    })
  }

  const refreshRegistry = async (): Promise<void> => {
    try {
      await mutateRegistry(() => registry.refresh())
    } catch (error) {
      publish(Object.freeze({
        type: "registry.failed",
        message: errorText(error),
      }))
    }
  }
  const structuralRefresh = new StorybookDirtyRefreshCoordinator(refreshRegistry)

  let server!: Bun.Server<StorybookWebSocketData>
  try {
    server = Bun.serve<StorybookWebSocketData>({
      hostname: options.hostname ?? "127.0.0.1",
      port: options.port ?? 0,
      idleTimeout: STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS,
      fetch: async (request, currentServer) => {
      const url = new URL(request.url)
      try {
        assertExternalStorybookRequestHost(request, server.url.origin)
        if (url.pathname === "/api/events") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
          if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
            return responseJson({error: "Storybook WebSocket upgrade is required"}, 426)
          }
          const sessionToken = websocketSessionToken(url)
          const grant = browserSessions.consume(sessionToken)
          if (currentServer.upgrade(request, {
            data: {subscriptions: new Set(), unsubscribers: new Map(), grant, sessionToken},
          })) return
          return responseJson({error: "WebSocket upgrade failed"}, 400)
        }
        if (url.pathname.startsWith("/api/control/")) {
          assertExternalStorybookControlRequest(request, {
            origin: server.url.origin,
            controlToken: serverRecord.controlToken,
          })
        }
        if (url.pathname === "/api/health" && request.method === "GET") {
          return responseJson({
            ok: true,
            protocol: "external-storybook-server/1",
            instanceId: serverRecord.instanceId,
            origin: server.url.origin,
            registryRevision: registry.snapshot().revision,
            graphDigest: registry.snapshot().graph.digest,
          })
        }
        if (url.pathname === "/api/status" && request.method === "GET") {
          const snapshot = registry.snapshot()
          const client = createExternalStorybookClientSnapshot(snapshot.graph, sessions.snapshots())
          return responseJson({
            ok: true,
            origin: server.url.origin,
            instanceId: serverRecord.instanceId,
            registryRevision: snapshot.revision,
            roots: snapshot.entries.map(({rootKind, canonicalId, digest, descendantIds}) => ({
              rootKind,
              canonicalId,
              digest,
              descendantCount: descendantIds.length,
            })),
            graphDigest: snapshot.graph.digest,
            packages: client.packages,
          })
        }
        if (url.pathname === "/api/control/status" && request.method === "GET") {
          const snapshot = registry.snapshot()
          return responseJson({
            ok: true,
            origin: server.url.origin,
            instanceId: serverRecord.instanceId,
            registryRevision: snapshot.revision,
            entries: snapshot.entries,
            graphDigest: snapshot.graph.digest,
            packages: sessions.snapshots(),
          })
        }
        if (url.pathname.startsWith("/api/control/views/") && request.method === "GET") {
          const viewId = requiredText("view id", decodeURIComponent(
            url.pathname.slice("/api/control/views/".length),
          ))
          return responseJson({ok: true, view: browserLifecycle.getView(viewId)})
        }
        if (url.pathname === "/api/control/views" && request.method === "GET") {
          const packages = registry.snapshot().graph.nodes.flatMap((node) =>
            node.kind === "package" && node.packageId !== null
              ? [{
                packageId: node.packageId,
                label: externalStorybookPageTitle(node.packageId, node.label),
              }]
              : [])
          return responseJson({
            ok: true,
            views: await browserLifecycle.listViews(server.url.origin, request.signal, packages),
          })
        }
        if (url.pathname === "/api/control/inspect" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["cursor", "include", "limit", "maxDepth", "viewId"])
          const result = await browserLifecycle.inspect(
            requiredText("inspect viewId", body.viewId),
            {
              ...(body.include === undefined ? {} : {include: requiredTextList("inspect include", body.include, 8)}),
              ...(body.maxDepth === undefined ? {} : {maxDepth: Number(body.maxDepth)}),
              ...(body.limit === undefined ? {} : {limit: Number(body.limit)}),
              ...(body.cursor === undefined ? {} : {cursor: requiredText("inspect cursor", body.cursor)}),
            },
            request.signal,
          )
          return responseJson({ok: true, ...result})
        }
        if (url.pathname === "/api/control/interact" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["action", "destination", "target", "timeoutMs", "value", "viewId"])
          const input = {
            viewId: requiredText("interact viewId", body.viewId),
            action: requiredText("interact action", body.action),
            ...(body.target === undefined ? {} : {target: body.target}),
            ...(body.value === undefined ? {} : {value: body.value}),
            ...(body.destination === undefined ? {} : {destination: body.destination}),
            ...(body.timeoutMs === undefined ? {} : {timeoutMs: Number(body.timeoutMs)}),
          } as StorybookBrowserInteractInput
          return responseJson({ok: true, ...await browserLifecycle.interact(input, request.signal)})
        }
        if (url.pathname === "/api/control/capture" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["area", "failOnConsoleError", "nodeId", "timeoutMs", "viewId"])
          const input = {
            viewId: requiredText("capture viewId", body.viewId),
            area: requiredText("capture area", body.area),
            ...(body.nodeId === undefined ? {} : {nodeId: requiredText("capture nodeId", body.nodeId)}),
            ...(body.failOnConsoleError === undefined ? {} : {failOnConsoleError: body.failOnConsoleError === true}),
            ...(body.timeoutMs === undefined ? {} : {timeoutMs: Number(body.timeoutMs)}),
          } as StorybookBrowserCaptureInput
          return responseJson({ok: true, ...await browserLifecycle.capture(input, request.signal)})
        }
        if (url.pathname === "/api/control/close" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["viewId"])
          return responseJson({
            ok: true,
            ...await browserLifecycle.close(requiredText("close viewId", body.viewId), request.signal),
          })
        }
        if (url.pathname.startsWith("/api/control/captures/") && request.method === "GET") {
          const captureId = requiredText("capture id", decodeURIComponent(
            url.pathname.slice("/api/control/captures/".length),
          ))
          const capture = browserLifecycle.readCapture(captureId)
          return responseJson({
            ok: true,
            metadata: capture.metadata,
            data: Buffer.from(capture.png).toString("base64"),
          })
        }
        if (url.pathname === "/api/client" && request.method === "GET") {
          const snapshot = registry.snapshot()
          return responseJson(createExternalStorybookClientSnapshot(snapshot.graph, sessions.snapshots()))
        }
        if (url.pathname === "/api/browser/activation" && request.method === "POST") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
          const token = request.headers.get("x-storybook-session") ?? ""
          const grant = browserSessions.authorize(token)
          if (grant.kind !== "package" || grant.packageId === null || grant.revision === null ||
            grant.viewId === null || grant.activationId === null || grant.packageGraphDigest === null) {
            throw new Error("Storybook browser session has no activation authority")
          }
          const body = await requestObject(request)
          assertExactRequestKeys(body, [
            "activationId", "diagnostic", "frameSequence", "packageGraphDigest",
            "packageId", "revision", "route", "working",
          ])
          const packageId = requiredText("activation packageId", body.packageId)
          const revision = requiredText("activation revision", body.revision)
          const activationId = requiredText("activation id", body.activationId)
          const packageGraphDigest = requiredText("activation graph digest", body.packageGraphDigest)
          const route = typeof body.route === "string" ? body.route : requiredText("activation route", body.route)
          if (typeof body.working !== "boolean") throw new Error("Storybook activation working must be boolean")
          if (packageId !== grant.packageId || revision !== grant.revision ||
            activationId !== grant.activationId || packageGraphDigest !== grant.packageGraphDigest) {
            throw new Error("Storybook browser activation does not match its scoped session")
          }
          const session = sessions.session(packageId)
          const result = body.working === true
            ? session.acknowledgeActivation({
              revision,
              activationId,
              viewId: grant.viewId,
              route,
              packageGraphDigest,
              frameSequence: Number(body.frameSequence),
            })
            : session.failActivation({
              revision,
              activationId,
              diagnostic: storybookDiagnostic(
                "activation",
                typeof body.diagnostic === "string" ? body.diagnostic.slice(0, 4_096) : "Storybook browser activation failed",
              ),
            })
          return responseJson({ok: body.working === true, package: result})
        }
        if (url.pathname === "/api/browser/open" && request.method === "POST") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
          const token = request.headers.get("x-storybook-session") ?? ""
          const grant = browserSessions.authorize(token)
          if (grant.kind !== "registry") {
            throw new Error("Only the Storybook landing session may request a package view")
          }
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["packageId", "route"])
          const packageId = requiredText("open packageId", body.packageId)
          const route = body.route === undefined || body.route === ""
            ? ""
            : requiredText("open route", body.route)
          const result = await openPackageView({packageId, route, foreground: true}, request.signal)
          const {package: _package, ...browserResult} = result
          return responseJson(browserResult)
        }
        if (url.pathname === "/api/control/attach" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["roots"])
          const roots = requiredTextList("attach roots", body.roots, 32)
          const snapshot = await mutateRegistry(() => registry.attachMany(roots, "cli"))
          return responseJson({
            ok: true,
            attached: snapshot.entries.slice(-roots.length).map(({rootKind, canonicalId, digest}) => ({
              rootKind,
              canonicalId,
              digest,
            })),
            graphDigest: snapshot.graph.digest,
          })
        }
        if (url.pathname === "/api/control/detach" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["scopeId"])
          const scopeId = requiredText("detach scopeId", body.scopeId)
          const currentPackages = registry.snapshot().graph.nodes.flatMap((node) =>
            node.kind === "package" && node.packageId !== null
              ? [{
                packageId: node.packageId,
                label: externalStorybookPageTitle(node.packageId, node.label),
              }]
              : [])
          const openViews = await browserLifecycle.listViews(
            server.url.origin,
            request.signal,
            currentPackages,
          )
          const snapshot = await mutateRegistry(() => registry.detach(scopeId))
          const retainedPackageIds = new Set(snapshot.graph.nodes.flatMap((node) =>
            node.kind === "package" && node.packageId !== null ? [node.packageId] : []))
          for (const view of openViews) {
            if (!retainedPackageIds.has(view.packageId)) await browserLifecycle.close(view.viewId, request.signal)
          }
          return responseJson({ok: true, graphDigest: snapshot.graph.digest})
        }
        if (url.pathname === "/api/control/refresh" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, [])
          const snapshot = await mutateRegistry(() => registry.refresh())
          return responseJson({
            ok: true,
            registryRevision: snapshot.revision,
            graphDigest: snapshot.graph.digest,
          })
        }
        if (url.pathname === "/api/control/check" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["live", "scope"])
          const scope = body.scope === undefined || body.scope === null
            ? null
            : requiredText("check scope", body.scope)
          const refreshed = await mutateRegistry(() => registry.refresh())
          const packageIds = resolveCheckPackages(refreshed, scope)
          for (const packageId of packageIds) sessions.retryFailed(packageId)
          const results = await Promise.all(packageIds.map((packageId) => sessions.ensure(packageId)))
          const ok = results.every((snapshot) => packageBuildSucceeded(snapshot))
          return responseJson({ok, graphDigest: registry.snapshot().graph.digest, packages: results})
        }
        if (url.pathname === "/api/control/wait" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["afterRevision", "condition", "packageId", "timeoutMs", "viewId"])
          const packageId = body.packageId === null || body.packageId === undefined
            ? null
            : requiredText("wait packageId", body.packageId)
          const condition = requiredText("wait condition", body.condition)
          if (!new Set(["built", "active", "ready", "presented", "failed"]).has(condition)) {
            throw new Error(`Unknown Storybook wait condition: ${condition}`)
          }
          if (packageId === null) throw new Error("Server-side Storybook wait requires packageId")
          const afterRevision = body.afterRevision === null || body.afterRevision === undefined
            ? null
            : requiredText("wait afterRevision", body.afterRevision)
          const timeoutMs = Number(body.timeoutMs ?? 30_000)
          if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
            throw new Error("Storybook wait timeout must be between 100 and 120000 ms")
          }
          const current = sessions.session(packageId).snapshot()
          const reached = packageCondition(current, condition, afterRevision)
          if (reached !== null) return responseJson({
            ok: true,
            timeout: false,
            condition,
            previousRevision: afterRevision,
            currentRevision: reached,
            package: current,
          })
          const event = await eventHub.wait((candidate) => packageEventCondition(
            candidate,
            packageId,
            condition,
            afterRevision,
          ), {timeoutMs, signal: request.signal})
          const next = sessions.session(packageId).snapshot()
          return responseJson({
            ok: event !== null,
            timeout: event === null,
            condition,
            previousRevision: afterRevision,
            currentRevision: packageCondition(next, condition, afterRevision),
            package: next,
          })
        }
        if (url.pathname === "/api/control/open" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["packageId", "route", "timeoutMs"])
          const packageId = requiredText("open packageId", body.packageId)
          const route = body.route === undefined || body.route === ""
            ? ""
            : requiredText("open route", body.route)
          return responseJson(await openPackageView({
            packageId,
            route,
            ...(body.timeoutMs === undefined ? {} : {timeoutMs: Number(body.timeoutMs)}),
          }, request.signal))
        }
        if (url.pathname === "/api/control/stop" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["confirm"])
          if (body.confirm !== true) throw new Error("External Storybook stop requires confirm: true")
          setTimeout(() => close(), 25)
          return responseJson({ok: true})
        }
        if (url.pathname.startsWith("/__storybook/resources/nodes/") && request.method === "GET") {
          return resourceResponse(registry.snapshot(), url)
        }
        if (url.pathname.startsWith("/__storybook/revisions/") && request.method === "GET") {
          return revisionAssetResponse(sessions, url.pathname)
        }
        if (url.pathname.startsWith("/__storybook/shared/") && request.method === "GET") {
          const assets = await ensureSharedAssets()
          return fileInsideResponse(assets.root, url.pathname.slice("/__storybook/shared/".length))
        }
        if (url.pathname === "/assets/inter-regular.ttf" && request.method === "GET") {
          const fontPath = fileURLToPath(import.meta.resolve("@engine/core/fonts/inter-regular.ttf"))
          return fileResponse(fontPath, "font/ttf")
        }
        if (url.pathname === "/schemas/manifest.schema.json" || url.pathname === "/schemas/catalog.schema.json") {
          return fileResponse(join(toolRoot, url.pathname), "application/schema+json; charset=utf-8")
        }
        if (url.pathname.startsWith("/packages/") && request.method === "GET") {
          return packagePageResponse(url, registry, sessions, ensureSharedAssets, browserSessions, server.url.origin)
        }
        if (request.method === "GET" && isLandingPath(registry.snapshot(), url.pathname)) {
          const assets = await ensureSharedAssets()
          const session = browserSessions.issue({kind: "registry", packageId: null, revision: null})
          const authorStyleSheets = await landingWorkbenchAuthorStyleSheets(registry, sessions)
          return htmlResponse(
            storybookHtml(
              externalStorybookPageTitle(null),
              `/__storybook/shared/${assets.landingEntry}`,
              "landing",
              session.token,
              null,
              null,
              authorStyleSheets,
            ),
            server.url.origin,
          )
        }
        return responseJson({error: "Unknown external Storybook route"}, 404)
      } catch (error) {
        return responseJson({error: errorText(error)}, statusForError(error))
      }
    },
    websocket: {
      maxPayloadLength: STORYBOOK_WEBSOCKET_MESSAGE_MAX_BYTES,
      open(websocket) {
        clients.add(websocket)
      },
      message(websocket, message) {
        try {
          const source = typeof message === "string" ? message : new TextDecoder().decode(message)
          if (new TextEncoder().encode(source).byteLength > STORYBOOK_WEBSOCKET_MESSAGE_MAX_BYTES) {
            throw new Error("Storybook WebSocket message is too large")
          }
          const value = JSON.parse(source) as unknown
          if (value === null || typeof value !== "object") throw new Error("Subscription must be an object")
          const record = value as Record<string, unknown>
          assertExactRequestKeys(record, ["type", "topic"])
          if (record.type !== "subscribe") throw new Error("Unknown Storybook WebSocket message")
          const topic = requiredText("subscription topic", record.topic)
          if (topic !== "registry" && !topic.startsWith("package:")) {
            throw new Error(`Invalid Storybook subscription topic: ${topic}`)
          }
          if (!websocket.data.grant.allowedTopics.has(topic)) {
            throw new Error(`Storybook browser session is not authorized for topic: ${topic}`)
          }
          if (topic.startsWith("package:") && !websocket.data.unsubscribers.has(topic)) {
            const packageId = topic.slice("package:".length)
            websocket.data.unsubscribers.set(topic, sessions.session(packageId).subscribe())
          }
          websocket.data.subscriptions.add(topic)
          websocket.send(JSON.stringify({type: "subscribed", topic}))
        } catch (error) {
          websocket.send(JSON.stringify({type: "subscription.failed", message: errorText(error)}))
        }
      },
      close(websocket) {
        for (const unsubscribe of websocket.data.unsubscribers.values()) unsubscribe()
        websocket.data.unsubscribers.clear()
        if (websocket.data.grant.kind === "package") {
          browserSessions.release(websocket.data.sessionToken)
        }
        clients.delete(websocket)
      },
    },
    })
  } catch (error) {
    await sessions.dispose()
    watch.dispose()
    browserSessions.dispose()
    eventHub.close()
    stoppedResolve!()
    throw error
  }

  try {
    serverRecord = createExternalStorybookServerRecord({
      toolRoot,
      origin: server.url.origin,
      implementationDigest,
      attachedDeclarations: registry.snapshot().entries.map(({declarationPath}) => declarationPath),
    })
    if (options.startLease === undefined) {
      writeServerRecord(statePath, serverRecord)
    } else {
      writeExternalStorybookStartCandidate(options.startLease, serverRecord)
      await waitForStartupPublication(options.startLease, serverRecord, statePath)
    }
    serverRecordCreated = true
    refreshStructuralWatch()
  } catch (error) {
    await sessions.dispose()
    watch.remove("__registry__")
    watch.dispose()
    browserSessions.dispose()
    eventHub.close()
    server.stop(true)
    if (serverRecordCreated) removeOwnedState(statePath, serverRecord)
    stoppedResolve!()
    throw error
  }

  const ensureSharedAssets = (): Promise<SharedBrowserAssets> => {
    sharedAssets ??= buildSharedBrowserAssets({
      root: join(artifactRoot, "shared"),
      toolRoot,
      landingEntryPath: options.landingEntryPath ?? fileURLToPath(
        new URL("./browser/landing-entry.ts", import.meta.url),
      ),
      fallbackEntryPath: options.fallbackEntryPath ?? fileURLToPath(
        new URL("./browser/fallback-entry.ts", import.meta.url),
      ),
    })
    return sharedAssets
  }

  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise
    closing = true
    closePromise = (async () => {
      for (const client of clients) client.close(1001, "Storybook server stopped")
      clients.clear()
      watch.remove("__registry__")
      watch.dispose()
      browserSessions.dispose()
      eventHub.close()
      await sessions.dispose()
      server.stop(true)
      removeOwnedState(statePath, serverRecord)
      stoppedResolve!()
    })()
    return closePromise
  }

  return Object.freeze({
    origin: server.url.origin,
    get record() {
      return serverRecord
    },
    registry,
    sessions,
    watch,
    browserLifecycle,
    server,
    stopped,
    stop: close,
  })
}

async function landingWorkbenchAuthorStyleSheets(
  registry: ExternalStorybookRegistry,
  sessions: ExternalStorybookSessionManager,
): Promise<readonly StorybookHtmlAuthorStyleSheet[]> {
  const self = registry.snapshot().graph.nodes.find((node) =>
    node.kind === "package" && node.packageId === "@zavx0z/storybook")
  if (self === undefined) return Object.freeze([])
  const snapshot = await sessions.ensure("@zavx0z/storybook")
  const revision = snapshot.builtRevision ?? snapshot.activatingRevision ??
    snapshot.activeRevision ?? snapshot.lastWorkingRevision ?? snapshot.lastGoodRevision
  if (revision === null) {
    throw new Error("Shared Storybook Workbench has no immutable theme revision")
  }
  const graph = sessions.session("@zavx0z/storybook").revisionGraphSnapshot(revision)
  if (graph === null) throw new Error("Shared Storybook Workbench revision graph is missing")
  const revisionUrl = revisionBase("@zavx0z/storybook", revision)
  return Object.freeze(mergeStorybookAuthorStyleSheets(
    graph.workbenchAuthorStyleSheets,
    graph.authorStyleSheets,
  ).map((styleSheet) => Object.freeze({
    ...styleSheet,
    href: `${revisionUrl}${styleSheet.url}`,
  })))
}

type RegistryEvent = Readonly<{
  type: "registry.updated"
  revision: number
  graphDigest: string
}> | Readonly<{
  type: "registry.failed"
  message: string
}>

type SharedBrowserAssets = Readonly<{
  root: string
  landingEntry: string
  fallbackEntry: string
}>

async function buildSharedBrowserAssets(input: Readonly<{
  root: string
  toolRoot: string
  landingEntryPath: string
  fallbackEntryPath: string
}>): Promise<SharedBrowserAssets> {
  const staging = `${input.root}.candidate-${randomUUID()}`
  rmSync(staging, {recursive: true, force: true})
  mkdirSync(staging, {recursive: true})
  const entrypoints = [realpathSync(input.landingEntryPath), realpathSync(input.fallbackEntryPath)]
  const plugins = await createStorybookPackageCompilerPlugins({
    packageRoot: input.toolRoot,
    projectRoot: input.toolRoot,
    moduleSourcePaths: entrypoints,
  })
  const result = await Bun.build({
    entrypoints,
    outdir: staging,
    root: dirname(realpathSync(input.landingEntryPath)),
    naming: {entry: "[name]-[hash].[ext]", chunk: "chunks/[name]-[hash].[ext]"},
    publicPath: "/__storybook/shared/",
    target: "browser",
    format: "esm",
    splitting: true,
    sourcemap: "external",
    loader: {".wgsl": "text"},
    plugins: [...plugins],
    metafile: true,
    throw: false,
  })
  if (!result.success) {
    rmSync(staging, {recursive: true, force: true})
    throw new Error(result.logs.map(({message}) => message).join("\n"))
  }
  const entryFor = (source: string): string => {
    const byName = result.outputs.find((artifact) =>
      artifact.kind === "entry-point" && basename(artifact.path).startsWith(basename(source, extname(source))))
    if (byName === undefined) throw new Error(`Shared Storybook entry was not emitted: ${source}`)
    return relative(staging, byName.path)
  }
  rmSync(input.root, {recursive: true, force: true})
  mkdirSync(dirname(input.root), {recursive: true})
  await Bun.write(join(staging, "manifest.json"), JSON.stringify({ok: true}))
  const landingEntry = entryFor(input.landingEntryPath)
  const fallbackEntry = entryFor(input.fallbackEntryPath)
  await import("node:fs/promises").then(({rename}) => rename(staging, input.root))
  return Object.freeze({root: input.root, landingEntry, fallbackEntry})
}

async function packagePageResponse(
  url: URL,
  registry: ExternalStorybookRegistry,
  sessions: ExternalStorybookSessionManager,
  ensureSharedAssets: () => Promise<SharedBrowserAssets>,
  browserSessions: StorybookBrowserSessionRegistry,
  origin: string,
): Promise<Response> {
  const route = parsePackageRequest(url.pathname)
  const packageNode = registry.snapshot().graph.nodes.find((node) =>
    node.kind === "package" && node.packageId === route.packageId)
  if (packageNode === undefined) {
    throw new Error(`Unknown Storybook package page title owner: ${route.packageId}`)
  }
  const pageTitle = externalStorybookPageTitle(route.packageId, packageNode.label)
  const snapshot = await sessions.ensure(route.packageId)
  const revision = snapshot.builtRevision ?? snapshot.activatingRevision ??
    snapshot.activeRevision ?? snapshot.lastWorkingRevision ?? snapshot.lastGoodRevision
  if (revision === null) {
    const assets = await ensureSharedAssets()
    const browserSession = browserSessions.issue({
      kind: "package",
      packageId: route.packageId,
      revision: null,
    })
    const authorStyleSheets = await landingWorkbenchAuthorStyleSheets(registry, sessions)
    return htmlResponse(
      storybookHtml(
        pageTitle,
        `/__storybook/shared/${assets.fallbackEntry}`,
        null,
        browserSession.token,
        null,
        null,
        authorStyleSheets,
      ),
      origin,
    )
  }
  const session = sessions.session(route.packageId)
  const graphSnapshot = session.revisionGraphSnapshot(revision)
  if (graphSnapshot === null) throw new Error(`Storybook revision graph is missing: ${route.packageId}:${revision}`)
  const resolvedRoute = graphSnapshot.routes.find(({path}) => path === route.routePath)
  if (resolvedRoute === undefined) throw new Error(`Unknown Storybook revision route: ${route.packageId}:${route.routePath}`)
  if (resolvedRoute.urlPath !== url.pathname) {
    return new Response(null, {status: 308, headers: {location: resolvedRoute.urlPath}})
  }
  const directory = session.revisionDirectory(revision)
  if (directory === null) throw new Error(`Active Storybook revision is missing: ${route.packageId}`)
  const revisionRecord = snapshot.revisions?.find((candidate) => candidate.revision === revision)
  if (revisionRecord === undefined) throw new Error(`Storybook revision record is missing: ${route.packageId}:${revision}`)
  const viewId = `browser:${randomUUID()}`
  const fallbackRevision = snapshot.builtRevision === revision
    ? snapshot.activeRevision ?? snapshot.lastWorkingRevision ?? snapshot.lastGoodRevision
    : null
  const activation = snapshot.builtRevision === revision
    ? session.beginActivation({revision, viewId, route: route.routePath})
    : null
  const lease = session.acquireRevisionLease(revision, viewId)
  const revisionUrl = revisionBase(route.packageId, revision)
  const script = `${revisionUrl}${revisionRecord.entryRelativePath}`
  const browserSession = browserSessions.issue({
    kind: "package",
    packageId: route.packageId,
    revision,
    viewId,
    activationId: activation?.activationId ?? null,
    packageGraphDigest: graphSnapshot.packageGraphDigest,
    release: lease.release,
  })
  return htmlResponse(
    storybookHtml(
      pageTitle,
      script,
      null,
      browserSession.token,
      activation?.activationId ?? null,
      fallbackRevision === revision ? null : fallbackRevision,
      mergeStorybookAuthorStyleSheets(
        graphSnapshot.workbenchAuthorStyleSheets,
        graphSnapshot.authorStyleSheets,
      ).map((styleSheet) => Object.freeze({
        ...styleSheet,
        href: `${revisionUrl}${styleSheet.url}`,
      })),
    ),
    origin,
  )
}

export function externalStorybookStructuralWatchPaths(
  snapshot: ExternalStorybookRegistrySnapshot,
): readonly string[] {
  return Object.freeze([...new Set(snapshot.graph.nodes.flatMap((node) => [
    node.source.path,
    ...(node.readmePath === null || node.kind !== "workspace" && node.kind !== "project"
      ? []
      : [node.readmePath]),
    ...(node.kind === "package" && node.packageJsonPath !== null ? [node.packageJsonPath] : []),
    ...node.authorStyleSheets.map(({path}) => path),
    ...node.authorStyleSheets.map(({ownerPackageJsonPath}) => ownerPackageJsonPath),
  ]))].sort())
}

function parsePackageRequest(pathname: string): Readonly<{packageId: string, routePath: string}> {
  const suffix = pathname.slice("/packages/".length)
  const slash = suffix.indexOf("/")
  if (slash < 0) throw new Error(`Malformed Storybook package route: ${pathname}`)
  const encodedPackage = suffix.slice(0, slash)
  let packageId: string
  try {
    packageId = decodeURIComponent(encodedPackage)
  } catch {
    throw new Error(`Malformed Storybook package identity: ${encodedPackage}`)
  }
  if (encodeURIComponent(packageId) !== encodedPackage) {
    throw new Error(`Non-canonical Storybook package identity: ${encodedPackage}`)
  }
  const encodedRoute = suffix.slice(slash + 1).replace(/\/$/u, "")
  const routePath = encodedRoute.length === 0
    ? ""
    : encodedRoute.split("/").map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (encodeURIComponent(decoded) !== segment || decoded === "." || decoded === "..") {
        throw new Error(`Non-canonical Storybook route segment: ${segment}`)
      }
      return decoded
    }).join("/")
  return Object.freeze({packageId, routePath})
}

function resourceResponse(snapshot: ExternalStorybookRegistrySnapshot, url: URL): Response {
  const pathname = url.pathname
  const suffix = pathname.slice("/__storybook/resources/nodes/".length)
  const [encoded, ...relativeSegments] = suffix.split("/")
  if (encoded === undefined || encoded.length === 0) throw new Error("Missing Storybook resource identity")
  const nodeId = decodeURIComponent(encoded)
  if (encodeURIComponent(nodeId) !== encoded) throw new Error(`Non-canonical Storybook resource identity: ${encoded}`)
  const node = externalStorybookNode(snapshot.graph, nodeId)
  const ownerRoot = resourceOwnerRoot(snapshot, node.id)
  let allowList
  try {
    allowList = createExternalStorybookResourceAllowList({
      ownerRoot,
      readmePath: node.readmePath,
      declaredResources: node.resources,
    })
  } catch {
    return responseJson({error: "Unknown Storybook resource"}, 404)
  }
  const kind = url.searchParams.get("kind")
  if (kind !== null) {
    if ([...url.searchParams.keys()].some((key) => key !== "kind" && key !== "index")) {
      throw new Error("Unknown Storybook resource query")
    }
    if (!new Set(["fixture", "test", "media", "reference", "evidence", "asset"]).has(kind)) {
      throw new Error(`Unknown Storybook resource kind: ${kind}`)
    }
    const indexValue = url.searchParams.get("index") ?? "0"
    if (!/^(?:0|[1-9][0-9]*)$/u.test(indexValue)) throw new Error(`Invalid Storybook resource index: ${indexValue}`)
    const resources = node.resources.filter((resource) => resource.kind === kind)
    const resource = resources[Number(indexValue)]
    if (resource === undefined) return responseJson({error: "Unknown node resource"}, 404)
    const path = allowList.resolveDeclaredResource(resource.path)
    return path === null
      ? responseJson({error: "Unknown node resource"}, 404)
      : fileResponse(path, contentType(path))
  }
  if ([...url.searchParams.keys()].length > 0) throw new Error("Unknown Storybook README resource query")
  if (node.readmePath === null) return responseJson({error: "Node has no README"}, 404)
  if (relativeSegments.length === 0 || relativeSegments.every((segment) => segment.length === 0)) {
    const path = allowList.resolveReadmeFile(node.readmePath)
    return path === null
      ? responseJson({error: "Unknown README resource"}, 404)
      : fileResponse(path, "text/markdown; charset=utf-8")
  }
  const decodedSegments = relativeSegments.filter(Boolean).map((segment) => {
    const decoded = decodeURIComponent(segment)
    if (decoded.length === 0 || decoded === "." || decoded === ".." || decoded.includes("\\") ||
      encodeURIComponent(decoded) !== segment) {
      throw new Error(`Unsafe Storybook README resource path: ${pathname}`)
    }
    return decoded
  })
  const path = allowList.resolveReadmeFile(
    resolve(dirname(node.readmePath), ...decodedSegments),
  )
  return path === null
    ? responseJson({error: "Unknown README resource"}, 404)
    : fileResponse(path, contentType(path))
}

function resourceOwnerRoot(snapshot: ExternalStorybookRegistrySnapshot, nodeId: string): string {
  let node = externalStorybookNode(snapshot.graph, nodeId)
  while (node.kind !== "workspace" && node.kind !== "project" && node.kind !== "package") {
    if (node.parentId === null) throw new Error(`Storybook resource node has no declaration owner: ${node.id}`)
    node = externalStorybookNode(snapshot.graph, node.parentId)
  }
  return realpathSync(dirname(dirname(node.source.path)))
}

function revisionAssetResponse(
  sessions: ExternalStorybookSessionManager,
  pathname: string,
): Response {
  const suffix = pathname.slice("/__storybook/revisions/".length)
  const [encodedPackage, revision, ...assetSegments] = suffix.split("/")
  if (encodedPackage === undefined || revision === undefined || assetSegments.length === 0) {
    return responseJson({error: "Malformed Storybook revision asset"}, 404)
  }
  const packageId = decodeURIComponent(encodedPackage)
  if (encodeURIComponent(packageId) !== encodedPackage || !/^[a-f0-9]{24}$/u.test(revision)) {
    throw new Error("Malformed Storybook revision identity")
  }
  const directory = sessions.session(packageId).revisionDirectory(revision)
  if (directory === null) return responseJson({error: "Unknown Storybook revision"}, 404)
  return fileInsideResponse(directory, assetSegments.join("/"))
}

function fileInsideResponse(root: string, encodedPath: string): Response {
  const segments = encodedPath.split("/").map((segment) => {
    const decoded = decodeURIComponent(segment)
    if (decoded.length === 0 || decoded === "." || decoded === ".." || decoded.includes("\\") ||
      encodeURIComponent(decoded) !== segment) {
      throw new Error(`Unsafe Storybook asset path: ${encodedPath}`)
    }
    return segment
  })
  const canonicalRoot = realpathSync(root)
  const path = canonicalContainedFile(resolve(canonicalRoot, ...segments), canonicalRoot)
  if (path === null) return responseJson({error: "Unknown Storybook asset"}, 404)
  return fileResponse(path, contentType(path))
}

function canonicalContainedFile(path: string, root: string): string | null {
  try {
    const canonicalRoot = realpathSync(root)
    const canonicalPath = realpathSync(path)
    if (!canonicalPath.startsWith(`${canonicalRoot}${sep}`) || !statSync(canonicalPath).isFile()) return null
    return canonicalPath
  } catch {
    return null
  }
}

function isLandingPath(snapshot: ExternalStorybookRegistrySnapshot, pathname: string): boolean {
  if (pathname === "/") return true
  return snapshot.graph.nodes.some((node) =>
    (node.kind === "workspace" || node.kind === "project") && node.urlPath === pathname)
}

function resolveCheckPackages(
  snapshot: ExternalStorybookRegistrySnapshot,
  scope: string | null,
): readonly string[] {
  const all = snapshot.graph.nodes.filter(({kind}) => kind === "package").map(({packageId}) => packageId!)
  if (scope === null) return Object.freeze(all)
  if (all.includes(scope)) return Object.freeze([scope])
  const entry = snapshot.entries.find(({canonicalId}) =>
    canonicalId === scope || canonicalId.slice(canonicalId.indexOf(":") + 1) === scope || declarationPathMatches(scope, canonicalId, snapshot))
  if (entry === undefined) throw new Error(`Unknown Storybook check scope: ${scope}`)
  return Object.freeze(snapshot.graph.nodes
    .filter((node) => entry.descendantIds.includes(node.id) && node.kind === "package")
    .map(({packageId}) => packageId!))
}

function packageBuildSucceeded(
  snapshot: ReturnType<ExternalStorybookSessionManager["snapshots"]>[number],
): boolean {
  if ((snapshot.buildState === "active" || snapshot.buildState === "ready") &&
    snapshot.activeRevision !== null) return true
  if (snapshot.buildState === "activating" && snapshot.activatingRevision !== null &&
    snapshot.diagnostics.length === 0) return true
  return snapshot.buildState === "built" && snapshot.builtRevision !== null &&
    snapshot.diagnostics.length === 0
}

function packageCondition(
  snapshot: ReturnType<ExternalStorybookSessionManager["snapshots"]>[number],
  condition: string,
  afterRevision: string | null,
): string | null {
  const revision = condition === "built"
    ? snapshot.builtRevision ?? snapshot.activeRevision
    : condition === "failed"
      ? snapshot.failedRevision ?? null
      : snapshot.activeRevision
  if (revision === null || revision === undefined || revision === afterRevision) return null
  if (condition === "built" && !["built", "activating", "active", "ready"].includes(snapshot.buildState)) return null
  if (condition === "failed" && snapshot.buildState !== "failed") return null
  if (["active", "ready", "presented"].includes(condition) &&
    !["active", "ready"].includes(snapshot.buildState)) return null
  return revision
}

function packageEventCondition(
  event: StorybookPackageEvent | RegistryEvent,
  packageId: string,
  condition: string,
  afterRevision: string | null,
): boolean {
  if (!("packageId" in event) || event.packageId !== packageId) return false
  const revision = "revision" in event && typeof event.revision === "string" ? event.revision : null
  if (revision === afterRevision) return false
  if (condition === "built") return event.type === "package.built" || event.type === "package.updated"
  if (condition === "failed") return event.type === "package.failed"
  return event.type === "package.updated"
}

function declarationPathMatches(
  scope: string,
  canonicalId: string,
  snapshot: ExternalStorybookRegistrySnapshot,
): boolean {
  if (!isAbsolute(scope)) return false
  const entry = snapshot.entries.find((candidate) => candidate.canonicalId === canonicalId)
  if (entry === undefined) return false
  try {
    return realpathSync(scope) === entry.declarationPath || realpathSync(join(scope, ".storybook", "manifest.json")) === entry.declarationPath
  } catch {
    return false
  }
}

function matchesSubscription(
  subscriptions: ReadonlySet<string>,
  event: StorybookPackageEvent | RegistryEvent,
): boolean {
  if (event.type === "registry.updated" || event.type === "registry.failed") {
    return subscriptions.has("registry")
  }
  return subscriptions.has("registry") || subscriptions.has(`package:${event.packageId}`)
}

export class StorybookBrowserSessionRegistry {
  readonly #sessions = new Map<string, StorybookBrowserSessionGrant>()
  readonly #active = new Map<string, StorybookBrowserSessionGrant>()
  readonly #ttlMs: number
  readonly #maxEntries: number
  readonly #now: () => number

  constructor(options: Readonly<{
    ttlMs?: number
    maxEntries?: number
    now?: () => number
  }> = {}) {
    this.#ttlMs = boundedRegistryNumber(options.ttlMs ?? STORYBOOK_BROWSER_SESSION_TTL_MS, 1, 3_600_000, "TTL")
    this.#maxEntries = boundedRegistryNumber(
      options.maxEntries ?? STORYBOOK_BROWSER_SESSION_MAX_ENTRIES,
      1,
      100_000,
      "entry limit",
    )
    this.#now = options.now ?? Date.now
  }

  issue(input: Readonly<{
    kind: StorybookBrowserSessionGrant["kind"]
    packageId: string | null
    revision: string | null
    viewId?: string | null
    activationId?: string | null
    packageGraphDigest?: string | null
    release?: () => void
  }>): Readonly<{token: string, grant: StorybookBrowserSessionGrant}> {
    this.#removeExpired()
    while (this.#sessions.size + this.#active.size >= this.#maxEntries) {
      const oldest = this.#sessions.keys().next().value ?? this.#active.keys().next().value
      if (oldest === undefined) break
      this.release(oldest)
    }
    if (input.kind === "registry" && (input.packageId !== null || input.revision !== null)) {
      throw new Error("Registry browser session cannot carry package identity")
    }
    if (input.kind === "package" && input.packageId === null) {
      throw new Error("Package browser session requires package identity")
    }
    const token = randomBytes(32).toString("base64url")
    const allowedTopics = input.kind === "registry"
      ? new Set<string>(["registry"])
      : new Set<string>([`package:${input.packageId}`])
    const grant = Object.freeze({
      kind: input.kind,
      packageId: input.packageId,
      revision: input.revision,
      viewId: input.viewId ?? null,
      activationId: input.activationId ?? null,
      packageGraphDigest: input.packageGraphDigest ?? null,
      allowedTopics,
      expiresAt: this.#now() + this.#ttlMs,
      release: once(input.release ?? (() => {})),
    })
    this.#sessions.set(token, grant)
    return Object.freeze({token, grant})
  }

  consume(token: string): StorybookBrowserSessionGrant {
    this.#removeExpired()
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) this.#reject()
    const grant = this.#sessions.get(token)
    if (grant === undefined || grant.expiresAt <= this.#now()) this.#reject()
    this.#sessions.delete(token)
    const active = Object.freeze({...grant, expiresAt: Number.POSITIVE_INFINITY})
    this.#active.set(token, active)
    return active
  }

  authorize(token: string): StorybookBrowserSessionGrant {
    this.#removeExpired()
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) this.#reject()
    const grant = this.#active.get(token) ?? this.#sessions.get(token)
    if (grant === undefined || grant.expiresAt <= this.#now()) this.#reject()
    return grant
  }

  release(token: string): void {
    const grant = this.#active.get(token) ?? this.#sessions.get(token)
    this.#active.delete(token)
    this.#sessions.delete(token)
    grant?.release()
  }

  dispose(): void {
    for (const grant of [...this.#sessions.values(), ...this.#active.values()]) grant.release()
    this.#sessions.clear()
    this.#active.clear()
  }

  #removeExpired(): void {
    const now = this.#now()
    for (const [token, grant] of this.#sessions) {
      if (grant.expiresAt <= now) this.release(token)
    }
  }

  #reject(): never {
    throw new ExternalStorybookSecurityError(
      "invalid-browser-session",
      401,
      "External Storybook browser session is missing, expired or invalid",
    )
  }
}

function boundedRegistryNumber(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Storybook browser session ${label} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function websocketSessionToken(url: URL): string {
  if ([...url.searchParams.keys()].some((key) => key !== "session")) {
    throw new ExternalStorybookSecurityError(
      "invalid-browser-session",
      401,
      "External Storybook WebSocket query is invalid",
    )
  }
  const token = url.searchParams.get("session")
  if (token === null || token.length === 0) {
    throw new ExternalStorybookSecurityError(
      "invalid-browser-session",
      401,
      "External Storybook browser session is required",
    )
  }
  return token
}

function once(operation: () => void): () => void {
  let called = false
  return () => {
    if (called) return
    called = true
    operation()
  }
}

function sanitizePackageFailure(
  event: Extract<StorybookPackageEvent, {type: "package.failed"}>,
  registry: ExternalStorybookRegistry,
  snapshots: () => ReturnType<ExternalStorybookSessionManager["snapshots"]>,
): unknown {
  try {
    const summary = createExternalStorybookClientSnapshot(
      registry.snapshot().graph,
      snapshots(),
    ).packages.find(({packageId}) => packageId === event.packageId)
    return summary === undefined
      ? {type: event.type, packageId: event.packageId, revision: event.revision, diagnostics: []}
      : {type: event.type, packageId: event.packageId, revision: event.revision, diagnostics: summary.diagnostics}
  } catch {
    return {type: event.type, packageId: event.packageId, revision: event.revision, diagnostics: []}
  }
}

function revisionBase(packageId: string, revision: string): string {
  return `/__storybook/revisions/${encodeURIComponent(packageId)}/${revision}/`
}

function storybookHtml(
  title: string,
  script: string,
  entry: "landing" | null = null,
  browserSessionToken: string,
  activationId: string | null,
  fallbackRevision: string | null = null,
  authorStyleSheets: readonly StorybookHtmlAuthorStyleSheet[] = Object.freeze([]),
): string {
  const styleSheetLinks = authorStyleSheets.map((styleSheet, index) => [
    `    <link id="external-storybook-author-style-sheet-${index}" rel="stylesheet"`,
    `data-external-storybook-author-style-sheet="${escapeHtml(styleSheet.specifier)}"`,
    `data-external-storybook-author-style-sheet-digest="${escapeHtml(styleSheet.contentDigest)}"`,
    `href="${escapeHtml(styleSheet.href)}">`,
  ].join(" ")).join("\n")
  return `<!doctype html>
<html lang="ru"${entry === null ? "" : ` data-external-storybook-entry="${entry}"`}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <meta name="engine-default-font" content="/assets/inter-regular.ttf">
    <meta name="external-storybook-browser-session" content="${escapeHtml(browserSessionToken)}">
    ${activationId === null ? "" : `<meta name="external-storybook-activation-id" content="${escapeHtml(activationId)}">`}
    ${fallbackRevision === null ? "" : `<meta name="external-storybook-fallback-revision" content="${escapeHtml(fallbackRevision)}">`}
${styleSheetLinks.length === 0 ? "" : `${styleSheetLinks}\n`}
    <title>${escapeHtml(title)}</title>
    <style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#111}#external-storybook-canvas{display:block;width:100%;height:100%;touch-action:none}</style>
  </head>
  <body>
    <canvas id="external-storybook-canvas" aria-label="Storybook Workbench"></canvas>
    <script type="module" src="${escapeHtml(script)}"></script>
  </body>
</html>`
}

function responseJson(value: unknown, status = 200): Response {
  return Response.json(value, {status, headers: {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  }})
}

function htmlResponse(value: string, origin: string): Response {
  const websocket = new URL(origin)
  websocket.protocol = websocket.protocol === "https:" ? "wss:" : "ws:"
  return new Response(value, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        `connect-src 'self' data: ${websocket.origin}`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
      "cross-origin-opener-policy": "same-origin",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  })
}

function fileResponse(path: string, type: string): Response {
  if (!existsSync(path) || !statSync(path).isFile()) return responseJson({error: "File not found"}, 404)
  return new Response(Bun.file(path), {headers: {
    "content-type": type,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  }})
}

function contentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8"
  if (path.endsWith(".css")) return "text/css; charset=utf-8"
  if (path.endsWith(".json") || path.endsWith(".map")) return "application/json; charset=utf-8"
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "text/markdown; charset=utf-8"
  if (path.endsWith(".txt")) return "text/plain; charset=utf-8"
  if (path.endsWith(".wasm")) return "application/wasm"
  if (path.endsWith(".png")) return "image/png"
  if (path.endsWith(".svg")) return "image/svg+xml"
  if (path.endsWith(".ttf")) return "font/ttf"
  return "application/octet-stream"
}

async function requestObject(request: Request): Promise<Record<string, unknown>> {
  const contentLength = request.headers.get("content-length")
  if (contentLength !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) ||
    Number(contentLength) > STORYBOOK_CONTROL_BODY_MAX_BYTES)) {
    throw new StorybookRequestError(413, "Storybook request body is too large")
  }
  const source = await boundedRequestText(request, STORYBOOK_CONTROL_BODY_MAX_BYTES)
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new StorybookRequestError(400, "Storybook request body must contain valid JSON", error)
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Storybook request body must be an object")
  }
  return value as Record<string, unknown>
}

async function boundedRequestText(request: Request, maxBytes: number): Promise<string> {
  if (request.body === null) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    length += result.value.byteLength
    if (length > maxBytes) {
      await reader.cancel("Storybook request body is too large")
      throw new StorybookRequestError(413, "Storybook request body is too large")
    }
    chunks.push(result.value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder("utf-8", {fatal: true}).decode(bytes)
  } catch (error) {
    throw new StorybookRequestError(400, "Storybook request body must be UTF-8", error)
  }
}

function requiredText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 4_096 ||
    /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Storybook ${label} must be non-empty text`)
  }
  return value
}

function requiredTextList(label: string, value: unknown, maxItems: number): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new Error(`Storybook ${label} must contain between 1 and ${maxItems} paths`)
  }
  return Object.freeze(value.map((entry, index) => requiredText(`${label}[${index}]`, entry)))
}

function assertExactRequestKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const accepted = new Set(allowed)
  for (const key of Object.keys(record)) {
    if (!accepted.has(key)) throw new Error(`Storybook request has unknown field: ${key}`)
  }
}

function statusForError(error: unknown): number {
  if (error instanceof ExternalStorybookSecurityError || error instanceof StorybookRequestError) {
    return error.status
  }
  const message = errorText(error)
  if (/Unknown|not found|does not exist|has no README/iu.test(message)) return 404
  if (/duplicate|ambiguous|already/iu.test(message)) return 409
  return 400
}

class StorybookRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : {cause})
    this.name = "StorybookRequestError"
    this.status = status
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function removeOwnedState(path: string, record: ExternalStorybookServerRecord): void {
  try {
    const current = readExternalStorybookServerRecord(path)
    if (current.pid === record.pid && current.processStart === record.processStart &&
      current.instanceId === record.instanceId && current.controlToken === record.controlToken) unlinkSync(path)
  } catch {
    // A missing or foreign state file is never removed.
  }
}

async function waitForStartupPublication(
  lease: Readonly<{path: string; token: string}>,
  record: ExternalStorybookServerRecord,
  statePath: string,
): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (existsSync(statePath)) {
      const current = readExternalStorybookServerRecord(statePath)
      if (current.pid === record.pid && current.processStart === record.processStart &&
        current.instanceId === record.instanceId && current.controlToken === record.controlToken) return
      throw new Error("Storybook startup state was published by another daemon")
    }
    assertExternalStorybookStartLease(lease.path, lease.token)
    await Bun.sleep(25)
  }
  throw new DOMException("Storybook controller did not publish daemon state", "TimeoutError")
}
