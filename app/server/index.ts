/**
Серверное исполнение приложения Storybook соединяет каталог, сессии пакетов,
Web-выпуск, browser lifecycle и авторизованный HTTP/WebSocket API в одном процессе.

@packageDocumentation
*/
import RouteUrlOwner from "@route/url"
import Zavx0zStorybookBrowserLifecycleOwner, {type Zavx0zStorybookBrowserLifecycle as Zavx0zStorybookBrowserLifecycleContract} from "@zavx0z/storybook-browser-lifecycle"
const storybookPackagePathMatches = RouteUrlOwner.storybookPackagePathMatches
const storybookPackageRouteFromPathname = RouteUrlOwner.storybookPackageRouteFromPathname
const storybookCurrentRouteKey = RouteUrlOwner.storybookCurrentRouteKey
const validStorybookViewQuery = RouteUrlOwner.validViewQuery
const createStorybookBrowserLifecycle = Zavx0zStorybookBrowserLifecycleOwner
type StorybookBrowserCaptureInput = Parameters<Zavx0zStorybookBrowserLifecycleContract.Output["capture"]>[0]
type StorybookBrowserInteractInput = Parameters<Zavx0zStorybookBrowserLifecycleContract.Output["interact"]>[0]
import activateRevision, {type HmrActivation as HmrActivationContract} from "@hmr/activation"
import {type ArchetypesScenarioReader as ArchetypesScenarioReaderContract} from "@archetypes/scenario-reader"
import PackageGraphReadOwner from "@package-graph/read"
import storybookRest from "@mcp/rest"
import McpRestRequestsOwner from "@mcp-rest/requests"
import AppServerCatalogOwner, {type AppServerCatalog as AppServerCatalogContract} from "@app-server/catalog"
import RepoDiscoveryOwner from "@repo/discovery"
import readProject from "@archetypes/project"
import PackageBuildPrepareOwner from "@package-build/prepare"
import {type PackageBuildScheduler as PackageBuildSchedulerContract} from "@package-build/scheduler"
import {type PackageRevision as PackageRevisionContract} from "@package/revision"
import AppServerSessionsOwner, {type AppServerSessions as AppServerSessionsContract} from "@app-server/sessions"
import PackageSessionOwner, {type PackageSession as PackageSessionContract} from "@package/session"
import PackageResourcesOwner from "@package/resources"
import TechLimitsOwner from "@tech/limits"
const externalStorybookBrowsePath = PackageGraphReadOwner.browsePath
const createMcpRequestJournal = McpRestRequestsOwner
const ExternalStorybookRegistry = AppServerCatalogOwner
const discoverStorybookPackages = RepoDiscoveryOwner
const createStorybookPackageRevisionBuilder = PackageBuildPrepareOwner
const ExternalStorybookSessionManager = AppServerSessionsOwner
const externalStorybookNode = PackageGraphReadOwner.node
const externalStorybookRoutes = PackageGraphReadOwner.routes
const resolveExternalStorybookRoute = PackageGraphReadOwner.resolve
const storybookDiagnostic = PackageSessionOwner.diagnostic
const createExternalStorybookResourceAllowList = PackageResourcesOwner
const STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS = TechLimitsOwner.STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS
type ActivationOutput = HmrActivationContract.Output
type ReadScenarioInput = ArchetypesScenarioReaderContract.Input
type ExternalStorybookRegistry = AppServerCatalogContract.Output
type ExternalStorybookRegistrySnapshot = ReturnType<AppServerCatalogContract.Output["snapshot"]>
type SharedBrowserAssets = ReturnType<AppWeb.Output["assets"]>
type StorybookBuildTransition = Parameters<Parameters<PackageBuildSchedulerContract.Output["subscribe"]>[0]>[0]
type StorybookPackageRevisionAuthorStyleSheet = ReturnType<PackageRevisionContract.Output["create"]>["workbenchAuthorStyleSheets"][number]
type ExternalStorybookSessionManager = AppServerSessionsContract.Output
type StorybookPackageEvent = Parameters<NonNullable<PackageSessionContract.Input[1]["publish"]>>[0]
import type {AppWeb} from "@app/web"
import state, {type AppServerState} from "@app-server/state"
import {StorybookBrowserSessionRegistry} from "./src/browser-session-registry"
import type {BrowserSessionGrant, WebSocketData} from "./contract/server"
import type {AppServer} from "./contract"

export type {AppServer} from "./contract"
import {streamAppOperation} from "./src/app-stream.ts"
import {sharedHostEvent} from "./src/shared-host-event.ts"
import WebProtocol, {type AppWebProtocol} from "@app-web/protocol"
type StorybookSharedHost = Awaited<ReturnType<AppWebProtocol.Output["readSharedHost"]>>
import {resolveStorybookRoute} from "./src/route"
import {createStorybookScenarioRunner} from "./src/scenario-run"
import {streamScenarioRun} from "./src/scenario-stream"
import {storybookMcpEntries} from "./src/mcp-entries"
import {createChatServer} from "./src/chat"
import proxyContent from "@app-mcp/response"
const errorContent = proxyContent.error
import {createCatalogRefresh} from "./src/catalog-refresh.ts"
import {refreshCheckCatalog} from "./src/check-catalog"
import {
  isStorybookNavigationSupersededError,
} from "./src/activation.ts"
import {preparingHtmlResponse} from "./src/preparing-html.ts"
import {
  prepareStorybookPackagePageTarget,
  type StorybookPackageBootstrapIntent,
} from "./src/package-page-target.ts"
import {randomUUID} from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
  unlinkSync,
} from "node:fs"
import {dirname, isAbsolute, join, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"
const createExternalStorybookClientSnapshot = WebProtocol.clientSnapshot
const STORYBOOK_FONT_FACES = WebProtocol.fontFaces
import {StorybookEventHub} from "./src/events.ts"
const externalStorybookPageTitle = WebProtocol.pageTitle

const {
  ExternalStorybookSecurityError,
  assertExternalStorybookControlRequest,
  assertExternalStorybookRequestHost,
  assertExternalStorybookRequestOrigin,
  assertExternalStorybookStartLease,
  createExternalStorybookServerRecord,
  externalStorybookArtifactRoot,
  externalStorybookServerStatePath,
  readExternalStorybookServerRecord,
  writeExternalStorybookServerRecord,
  writeExternalStorybookStartCandidate,
} = state
type ExternalStorybookServerRecord = ReturnType<AppServerState.Output["readExternalStorybookServerRecord"]>

const STORYBOOK_CONTROL_BODY_MAX_BYTES = 65_536
const STORYBOOK_MCP_JOURNAL_BODY_MAX_BYTES = 8 * 1024 * 1024
const STORYBOOK_WEBSOCKET_MESSAGE_MAX_BYTES = 8_192

type StorybookHtmlAuthorStyleSheet = StorybookPackageRevisionAuthorStyleSheet & Readonly<{
  href: string
}>

/**
Запускает единый внешний HTTP/WebSocket-сервер Storybook и публикует его запись.

@param options - Подключения и пути согласно {@link AppServer.Input}; порт `0`
позволяет ОС выбрать свободный адрес, если другой не задан.
@returns Работающий instance согласно {@link AppServer.Output}; остановка
принадлежит вызывающему коду и выполняется через `stop`.
@throws Ошибка discovery, подготовки shared resources, открытия listener или
публикации server state освобождает уже созданные ресурсы и не возвращает instance.
*/
export default async function startExternalStorybookServer(
  options: AppServer.Input,
): Promise<AppServer.Output> {
  const toolRoot = realpathSync(options.toolRoot ?? fileURLToPath(new URL("../..", import.meta.url)))
  const createWeb = options.createWeb
  const statePath = resolve(options.statePath ?? externalStorybookServerStatePath())
  const artifactRoot = resolve(options.artifactRoot ?? externalStorybookArtifactRoot())
  const writeServerRecord = options.writeServerRecord ?? writeExternalStorybookServerRecord
  const browserLifecycle = options.browserLifecycle ?? createStorybookBrowserLifecycle({
    stateRoot: resolve(options.browserStateRoot ?? join(dirname(statePath), "browser")),
    captureRoot: resolve(options.captureRoot ?? join(dirname(statePath), "captures")),
  })
  mkdirSync(artifactRoot, {recursive: true, mode: 0o700})
  chmodSync(artifactRoot, 0o700)
  const registry = new ExternalStorybookRegistry(options.resolveCatalog ?? discoverStorybookPackages, () => web.readStyleSheets())
  options.onStartupPhase?.("catalog")
  let project = await readProject({path: options.project})
  const clients = new Set<Bun.ServerWebSocket<WebSocketData>>()
  let serverRecord!: ExternalStorybookServerRecord
  let serverRecordCreated = false
  let stoppedResolve: () => void
  const stopped = new Promise<void>((resolvePromise) => {
    stoppedResolve = resolvePromise
  })
  let closePromise: Promise<void> | null = null
  const browserSessions = new StorybookBrowserSessionRegistry()
  const eventHub = new StorybookEventHub<StorybookPackageEvent | RegistryEvent>()
  const publish = (event: StorybookPackageEvent | RegistryEvent): number => {
    eventHub.publish(event)
    const browserEvent = event.type === "package.failed"
      ? sanitizePackageFailure(event, registry, () => sessions.snapshots(), project.name)
      : event
    const payload = JSON.stringify(browserEvent)
    let delivered = 0
    for (const client of clients) {
      if (!matchesSubscription(client.data.subscriptions, event)) continue
      if (event.type === "shared.updated" && !canRefreshSharedHost(client.data.grant)) continue
      try {
        client.send(payload)
        delivered += 1
      } catch (error) {
        console.error("External Storybook WebSocket publication failed", error)
      }
    }
    return delivered
  }
  const web = createWeb({
    toolRoot,
    artifactRoot,
    scheduler: () => sessions.buildScheduler,
    revisions: () => sessions.snapshots(),
    publish,
    ...(options.buildWeb === undefined ? {} : {build: options.buildWeb}),
    ...(options.landingEntryPath === undefined ? {} : {landingEntryPath: options.landingEntryPath}),
    ...(options.fallbackEntryPath === undefined ? {} : {fallbackEntryPath: options.fallbackEntryPath}),
  })
  const sharedAssetRoot = web.artifactRoot
  try {
    await registry.configure(project.repositories.map(repository => repository.root))
    options.onStartupPhase?.("sessions")
  } catch (error) {
    await web.dispose()
    browserSessions.dispose()
    eventHub.close()
    stoppedResolve!()
    throw error
  }
  const usesSharedKernel = options.packageBrowserEntryPath === undefined
  let preparedSharedIdentity = usesSharedKernel ? web.platform : undefined
  /**
  Выбирает опубликованную среду для подготовки пакетной ревизии.
  Изменения исходников самого Storybook применяются отдельной явной операцией.
  Подготовка пакета не запускает компилятор среды или Web-интерфейса.

  @param signal - Отмена конкретного ожидания; общая работа сохраняет собственный lifecycle.

  @throws Если общая сборка не предоставила проверенную module identity или ожидание отменено.
  */
  const prepareSharedIdentity = async (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted()
    if (!usesSharedKernel) return
    const assets = web.assets()
    signal.throwIfAborted()
    if (assets.browserIdentity === undefined) {
      throw new Error("Shared browser dependencies are not ready for a new package build")
    }
    if (preparedSharedIdentity !== assets.browserIdentity) {
      preparedSharedIdentity = assets.browserIdentity
    }
  }
  const sessions = new ExternalStorybookSessionManager({
    artifactRoot,
    ...(usesSharedKernel ? {prepareBuild: prepareSharedIdentity} : {}),
    buildRevision: createStorybookPackageRevisionBuilder({
      toolRoot,
      ...(usesSharedKernel ? {resolveSharedBrowserIdentity: async () => {
        if (preparedSharedIdentity === undefined) throw new Error("Shared browser dependencies must be prepared before compiler admission")
        return preparedSharedIdentity
      }} : {}),
      browserEntryPath: options.packageBrowserEntryPath ?? web.packageEntryPath,
    }),
    publish,
  })
  sessions.sync(registry.packageDescriptors(), declarationFailures(registry.snapshot()))
  const unsubscribeBuildProgress = sessions.buildScheduler.subscribe(event => {
    publish(Object.freeze({type: "build.progress", ...event}))
  })

  const commitRegistry = (snapshot: ExternalStorybookRegistrySnapshot): void => {
    const nextRecord = Object.freeze({
      ...serverRecord,
      attachedDeclarations: Object.freeze(snapshot.entries.map(({declarationPath}) => declarationPath)),
    })
    writeServerRecord(statePath, nextRecord)
    sessions.sync(registry.packageDescriptors(), declarationFailures(registry.snapshot()))
    serverRecord = nextRecord
    publish(Object.freeze({
      type: "registry.updated",
      revision: snapshot.revision,
      graphDigest: snapshot.graph.digest,
    }))
  }

  const applyRegistryMutation = async (
    operation: () => Promise<ExternalStorybookRegistrySnapshot>,
  ): Promise<ExternalStorybookRegistrySnapshot> => {
    const before = registry.snapshot()
    const beforeRecord = serverRecord
    const beforeProject = project
    try {
      const snapshot = await operation()
      if (snapshot.revision !== before.revision || project.name !== beforeProject.name) commitRegistry(snapshot)
      return snapshot
    } catch (error) {
      project = beforeProject
      if (registry.snapshot().revision !== before.revision || registry.snapshot().graph !== before.graph) {
        registry.restore(before)
        try {
          writeServerRecord(statePath, beforeRecord)
          sessions.sync(registry.packageDescriptors(), declarationFailures(registry.snapshot()))
          serverRecord = beforeRecord
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "External Storybook registry rollback failed")
        }
      }
      throw error
    }
  }

  let registryTail: Promise<unknown> = Promise.resolve()
  const mutateRegistry = (operation: () => Promise<ExternalStorybookRegistrySnapshot>): Promise<ExternalStorybookRegistrySnapshot> => {
    const pending = registryTail.then(() => applyRegistryMutation(operation))
    registryTail = pending.catch(() => {})
    return pending
  }

  const assertRegistryBrowserRequest = (request: Request): void => {
    assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
    const grant = browserSessions.authorize(request.headers.get("x-storybook-session") ?? "")
    if (grant.kind !== "registry") throw new Error("Only the Storybook landing may change the project list")
  }

  const refreshCatalog = createCatalogRefresh(force => mutateRegistry(async () => {
    const resolving = force || registry.dirtySnapshot().dirty
    if (resolving) publish({type: "catalog.progress", state: "running"})
    try {
      const nextProject = await readProject({path: project.root})
      const roots = nextProject.repositories.map(repository => repository.root)
      const previousRoots = project.repositories.map(repository => repository.root)
      const changed = roots.length !== previousRoots.length || roots.some((root, index) => root !== previousRoots[index])
      const result = await (changed ? registry.configure(roots) : force ? registry.refresh() : registry.refreshIfNeeded())
      project = nextProject
      if (resolving) publish({type: "catalog.progress", state: "completed"})
      return result
    } catch (error) {
      if (resolving) publish({type: "catalog.progress", state: "failed"})
      throw error
    }
  }))

  const openPackageView = async (
    input: Readonly<{
      packageId: string
      route: string
      timeoutMs?: number
      existingViewId?: string
      recover?: boolean
    }>,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> => {
    await refreshCatalog()
    const graph = registry.snapshot().graph
    const resolvedRoute = resolveExternalStorybookRoute(
      graph,
      input.packageId,
      storybookCurrentRouteKey(input.route),
    )
    const packageNode = graph.nodes.find((node) =>
      node.kind === "package" && node.packageId === input.packageId)
    if (packageNode === undefined) throw new Error(`Unknown Storybook package: ${input.packageId}`)
    const packageState = sessions.session(input.packageId).snapshot()
    if (!packageState.builtRevision && !packageState.activeRevision) throw new Error("Пакет ещё не собран. Выполните storybook_check для этого пакета.")
    const expectedRevision = packageState.builtRevision ?? packageState.activeRevision ?? undefined
    if (packageState.revisions?.find(record => record.revision === expectedRevision)?.sharedModuleEpoch === undefined) {
      throw new Error("Сохранённая ревизия пакета имеет старый формат. Выполните storybook_check для этого пакета перед открытием.")
    }
    const selectedRoute = expectedRevision === undefined ? resolvedRoute :
      sessions.session(input.packageId).revisionGraphSnapshot(expectedRevision)?.routes.find(route => route.nodeId === resolvedRoute.nodeId && route.kind === resolvedRoute.kind) ?? resolvedRoute
    const previewUrl = new URL(selectedRoute.urlPath, server.url)
    if (packageState.builtRevision != null && packageState.builtRevision !== packageState.activeRevision) {
      previewUrl.searchParams.set("preview", packageState.builtRevision)
    }
    const openInput = {
      ...(input.recover === undefined ? {} : {recover: input.recover}),
      origin: server.url.origin,
      packageId: input.packageId,
      route: selectedRoute.path,
      url: previewUrl.href,
      packageLabel: externalStorybookPageTitle(packageNode.packageId, packageNode.label),
      knownPackages: graph.nodes.filter(node => node.kind === "package").map(node => ({
        packageId: node.packageId!, label: node.label, urlPath: node.urlPath,
      })),
      ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
      ...(input.existingViewId === undefined ? {} : {existingViewId: input.existingViewId}),
      ...(expectedRevision === undefined ? {} : {expectedRevision}),
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
        route: selectedRoute.path,
        url: previewUrl.href,
        packageLabel: externalStorybookPageTitle(packageNode.packageId, packageNode.label),
        knownPackages: openInput.knownPackages,
        ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
        ...(input.existingViewId === undefined ? {} : {existingViewId: input.existingViewId}),
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
      frameSequence: opened.identity.frameSequence ?? 0,
      reused: opened.reused,
      ...(expectedRevision === undefined ? {} : {candidateRevision: expectedRevision}),
      workingFallback: opened.identity.ready && !candidateMatches,
      package: sessions.session(input.packageId).snapshot(),
    })
  }

  /** Проверяет exact opened candidate через agent bridge и только затем подтверждает activation lease. */
  const verifyAndMaybeApplyOpenedCandidate = async (
    candidate: StorybookActivationCandidate,
    route: string,
    opened: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    apply: boolean,
  ): Promise<void> => {
    const session = sessions.session(candidate.packageId)
    const revisionGraph = session.revisionGraphSnapshot(candidate.revision)
    if (revisionGraph === null) throw new Error(`Storybook revision graph is missing: ${candidate.packageId}`)
    if (opened.ok !== true || opened.packageId !== candidate.packageId || opened.route !== route ||
      opened.revision !== candidate.revision || opened.graphDigest !== revisionGraph.packageGraphDigest ||
      opened.ready !== true || opened.presented !== true || Number(opened.frameSequence) < 1) {
      throw new Error(`Package candidate did not open with exact identity: ${candidate.packageId}`)
    }
    const viewId = String(opened.viewId)
    await activateRevision({
      expected: {packageId: candidate.packageId, revision: candidate.revision, route, graphDigest: revisionGraph.packageGraphDigest},
      signal,
      async inspect() {
        const inspected = await browserLifecycle.inspect(
          viewId,
          {include: opened.inPageApplied === true ? ["state", "diagnostics"] : ["state", "diagnostics", "console"]},
          signal,
        )
        return opened.inPageApplied === true ? {...inspected, consoleErrors: opened.consoleErrors} : inspected
      },
      ...(apply ? {commit({frameSequence}: ActivationOutput) {
        if (session.snapshot().builtRevision !== candidate.revision) {
          throw new Error(`Storybook activation candidate became stale: ${candidate.packageId}`)
        }
        const activation = session.beginActivation({revision: candidate.revision, viewId, route})
        try {
          session.acknowledgeActivation({...activation, frameSequence})
        } catch (error) {
          if (session.snapshot().activatingRevision === candidate.revision) {
            session.failActivation({
              ...activation,
              diagnostic: storybookDiagnostic("activation", errorText(error)),
            })
          }
          throw error
        }
      }} : {}),
    })
  }

  const readSharedAssets = web.assets
  const readSharedHost = web.host
  const rebuildWeb = (live: boolean) => web.rebuild({apply: live})
  const canRefreshSharedHost = (grant: BrowserSessionGrant): boolean => web.canRefresh(grant.packageId, grant.revision)
  /** HTTP-ожидание объединяет состояние Web и события общей очереди приложения. */
  const webProgress = (listener: (value: Readonly<Record<string, unknown>>) => void): (() => void) => {
    const unsubscribe = web.subscribe(listener)
    const events = eventHub.subscribe(event => {
      if (event.type === "build.progress" && event.packageId === null) listener(event)
    })
    return () => {
      unsubscribe()
      events.close()
    }
  }

  const mcpRequests = createMcpRequestJournal()
  const runScenario = createStorybookScenarioRunner()
  let journalWriteError: {at: string, message: string} | null = null
  /** Один предметный обработчик для MCP-прокси и просмотра ответа по адресу UI. */
  const mcpEntries = () => storybookMcpEntries(registry.snapshot())
  const readStorybook = (request: Request) => storybookRest(request, {projectName: project.name, entries: mcpEntries()})

  let server!: Bun.Server<WebSocketData>
  const chat = createChatServer({
    project: project.root,
    projectName: () => project.name,
    toolRoot,
    origin: () => server.url.origin,
    graph: () => registry.snapshot().graph,
    entries: mcpEntries,
  })
  try {
    await options.migrateChats?.(chat.chats, registry.snapshot().graph)
    options.onStartupPhase?.("listen")
    server = Bun.serve<WebSocketData>({
      hostname: options.hostname ?? "127.0.0.1",
      port: options.port ?? 0,
      idleTimeout: STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS,
      fetch: async (request, currentServer) => {
      const url = new URL(request.url)
      try {
        assertExternalStorybookRequestHost(request, server.url.origin)
        if (request.method === "GET" && options.previousAddress !== undefined) {
          const address = options.previousAddress(url.pathname, registry.snapshot().graph)
          if (address !== null) {
            if (!registry.snapshot().graph.nodes.some(node => node.urlPath === address && node.kind !== "unavailable")) {
              throw new Error("Прежний адрес не разрешён в текущем каталоге")
            }
            return new Response(null, {status: 307, headers: {location: `${address}${url.search}`}})
          }
        }
        if (url.pathname === "/api/chat/mcp") {
          assertExternalStorybookRequestOrigin(request, server.url.origin)
          return await chat.scopedMcp(request)
        }
        if (url.pathname.startsWith("/api/browser/chat/")) {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: request.method !== "GET"})
          browserSessions.authorize(request.headers.get("x-storybook-session") ?? "")
          return await chat.request(request)
        }
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
          const client = createExternalStorybookClientSnapshot(snapshot.graph, sessions.snapshots(), project.name)
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
            projectName: project.name,
            packages: client.packages,
          })
        }
        if (url.pathname === "/api/control/mcp-requests" && request.method === "POST") {
          try {
            mcpRequests.write(await requestObject(request, STORYBOOK_MCP_JOURNAL_BODY_MAX_BYTES))
          } catch (error) {
            journalWriteError = {at: new Date().toISOString(), message: errorText(error)}
            throw error
          }
          return responseJson({status: "success"})
        }
        if (url.pathname.startsWith("/api/browser/mcp-captures/") && request.method === "GET") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: false})
          browserSessions.authorize(request.headers.get("x-storybook-session") ?? "")
          const captureId = decodeURIComponent(url.pathname.slice("/api/browser/mcp-captures/".length))
          const capture = browserLifecycle.readCapture(captureId)
          return new Response(new Uint8Array(capture.png), {headers: {"content-type": "image/png", "cache-control": "private, no-store"}})
        }
        if (url.pathname === "/api/browser/shared" && request.method === "GET") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: false})
          const grant = browserSessions.authorize(request.headers.get("x-storybook-session") ?? "")
          if ([...url.searchParams.keys()].some(key => key !== "sharedModuleEpoch" && key !== "preview")) throw new Error("Unknown shared host query")
          const preview = url.searchParams.has("preview")
          if (preview && url.searchParams.get("preview") !== "1") throw new Error("Invalid shared host preview query")
          if (preview && !grant.preview && grant.intent !== "navigation-candidate") return responseJson({error: "Shared host preview is not authorized"}, 403)
          const epoch = url.searchParams.get("sharedModuleEpoch") ?? undefined
          return responseJson(readSharedHost(epoch, preview))
        }
        if (url.pathname === "/api/browser/mcp-requests" && request.method === "GET") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: false})
          browserSessions.authorize(request.headers.get("x-storybook-session") ?? "")
          return responseJson({entries: mcpRequests.read()})
        }
        if (url.pathname === "/api/browser/mcp-address" && request.method === "POST") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
          browserSessions.authorize(request.headers.get("x-storybook-session") ?? "")
          const source = await requestObject(request)
          assertExactRequestKeys(source, ["address"])
          if (typeof source.address !== "string" || !source.address.startsWith("/") || source.address.startsWith("//")) {
            throw new Error("Ожидается локальный адрес страницы")
          }
          let input: {path?: string} | null = null
          try {
            const pathname = source.address.split(/[?#]/u)[0]!.slice(1)
            const owner = mcpEntries().find(item => pathname === item.path)
            if (pathname !== "" && owner === undefined) throw new Error("Страница отсутствует в публичной структуре")
            input = owner === undefined ? {} : {path: owner.path}
            const reply = await readStorybook(new Request(new URL("/api/control/storybook", server.url.origin), {
              method: "POST",
              body: JSON.stringify(input),
              signal: request.signal,
            }))
            const result = await reply.json()
            if (!reply.ok) throw new Error(typeof result.error === "string" ? result.error : `Storybook control API failed with ${reply.status}`)
            return responseJson({input, ...proxyContent(result)})
          } catch (error) {
            return responseJson({input, ...errorContent(error)})
          }
        }
        if (url.pathname === "/api/control/storybook") {
          // Успешный обзор имеет предметную форму без lifecycle status; ошибки сохраняют явный статус.
          return await readStorybook(request)
        }
        if (url.pathname === "/api/control/status" && request.method === "GET") {
          const snapshot = registry.snapshot()
          const packageIds = resolveCheckPackages(snapshot, url.searchParams.get("scope"))
          const packageStates = sessions.snapshots()
          const selectedStates = packageStates.filter(item => packageIds.includes(item.packageId))
          const dirty = registry.dirtySnapshot()
          return responseJson({
            ok: true,
            origin: server.url.origin,
            instanceId: serverRecord.instanceId,
            registryRevision: snapshot.revision,
            entries: snapshot.entries,
            declarationErrors: snapshot.catalog.scopes.filter(scope => scope.resolutionError !== undefined).map(scope => ({scopeId: scope.canonicalId, message: scope.resolutionError})),
            graphDigest: snapshot.graph.digest,
            packages: packageStates,
            sharedBuildError: web.error,
            app: {web: web.read()},
            requestJournal: {entries: mcpRequests.summary(), lastWriteError: journalWriteError},
            buildScheduler: sessions.buildSchedulerSnapshot({sampleResources: true}),
            discovery: {...registry.metrics(), dirty: dirty.dirty, dirtyPaths: dirty.paths.length, dirtyOwners: dirty.scopeRoots.length},
            preflight: {
              scopeResolved: true,
              packageIds,
              packages: selectedStates.map(item => ({
                packageId: item.packageId,
                buildState: item.buildState,
                cacheOutcome: item.cacheOutcome ?? null,
              })),
            },
          })
        }
        if (url.pathname.startsWith("/api/control/views/") && request.method === "GET") {
          const viewId = requiredText("view id", decodeURIComponent(
            url.pathname.slice("/api/control/views/".length),
          ))
          return responseJson({ok: true, view: browserLifecycle.getView(viewId)})
        }
        if (url.pathname === "/api/control/views" && request.method === "GET") {
          const packageId = url.searchParams.has("packageId") ? requiredText("views packageId", url.searchParams.get("packageId")) : undefined
          const packages = registry.snapshot().graph.nodes.flatMap((node) =>
            node.kind === "package" && node.packageId !== null
              ? [{
                packageId: node.packageId,
                label: externalStorybookPageTitle(node.packageId, node.label),
                urlPath: node.urlPath,
              }]
              : [])
          return responseJson({
            ok: true,
            views: await browserLifecycle.listViews(server.url.origin, request.signal, packages, packageId),
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
        if (url.pathname === "/api/browser/scenarios/run" && request.method === "POST") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
          const token = request.headers.get("x-storybook-session") ?? ""
          const grant = browserSessions.authorize(token)
          const body = await requestObject(request, STORYBOOK_MCP_JOURNAL_BODY_MAX_BYTES)
          assertExactRequestKeys(body, ["nodeId", "revision", "variantId", "props", "rerun"])
          if (body.rerun !== undefined && typeof body.rerun !== "boolean") throw new TypeError("rerun должен быть логическим значением")
          const revision = requiredText("scenario revision", body.revision)
          if (grant.kind !== "package" || grant.packageId === null || grant.revision !== revision) {
            throw new ExternalStorybookSecurityError("invalid-browser-session", 403, "Запуск не принадлежит сессии пакета")
          }
          if (body.props === null || typeof body.props !== "object" || Array.isArray(body.props)) {
            throw new TypeError("props должен быть объектом параметров")
          }
          const input = {
            nodeId: requiredText("scenario nodeId", body.nodeId),
            revision,
            variantId: requiredText("scenario variantId", body.variantId),
            props: body.props as Record<string, unknown>,
            ...(body.rerun === true ? {rerun: true} : {}),
          }
          const execute = async (signal: AbortSignal, onProgress?: ReadScenarioInput["onProgress"]) => {
            try {
              return await runScenario(input, grant.packageId!, registry.snapshot(), sessions, signal, onProgress)
            } finally {
              browserSessions.release(token)
            }
          }
          return request.headers.get("accept")?.includes("application/x-ndjson")
            ? streamScenarioRun(request.signal, execute)
            : responseJson(await execute(request.signal))
        }
        if (url.pathname === "/api/browser/registry-session" && request.method === "POST") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
          assertExactRequestKeys(await requestObject(request), [])
          const reader = browserSessions.issue({kind: "registry", packageId: null, revision: null})
          return responseJson({protocol: "storybook-registry-reader/1", readerToken: reader.token})
        }
        if (url.pathname === "/api/browser/route" && request.method === "POST") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["route"])
          if (typeof body.route !== "string" || body.route.length > 2048) throw new Error("Маршрут должен быть ограниченной строкой")
          await refreshCatalog()
          const target = await resolveStorybookRoute(body.route, registry.snapshot())
          return target === null ? responseJson({error: "Маршрут не найден"}, 404) : responseJson(target)
        }
        if (url.pathname === "/api/browser/prepare" && request.method === "POST") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["packageId", "route", "previewRevision"])
          const packageId = requiredText("prepare packageId", body.packageId)
          if (typeof body.route !== "string" || body.route.length > 1_024) {
            throw new Error("Package prepare route must be a bounded string")
          }
          const preview = body.previewRevision === undefined || body.previewRevision === null
            ? null : requiredText("prepare preview revision", body.previewRevision)
          if (preview !== null && !/^[A-Za-z0-9_-]{1,256}$/u.test(preview)) {
            throw new Error("Package prepare preview revision is invalid")
          }
          await refreshCatalog()
          request.signal.throwIfAborted()
          const session = sessions.session(packageId)
          const routePath = storybookCurrentRouteKey(body.route)
          const currentRoute = externalStorybookRoutes(registry.snapshot().graph).find(candidate =>
            candidate.packageId === packageId && candidate.path === routePath)
          if (preview === null) {
            if (currentRoute === undefined) throw new Error(`Unknown Storybook route: ${packageId}:${routePath}`)
          }
          request.signal.throwIfAborted()
          // Время очереди не является HTTP idle timeout; worker сохраняет собственный бюджет.
          server.timeout(request, 0)
          const target = await prepareStorybookPackagePageTarget({
            session,
            routePath,
            previewRevision: preview,
            currentRoute: currentRoute ?? null,
            signal: request.signal,
          })
          if (target.kind === "fallback") {
            if (currentRoute === undefined) throw new Error(`Unknown Storybook route: ${packageId}:${routePath}`)
            const reader = browserSessions.issue({kind: "package", packageId, revision: null, intent: "reader", preview: false})
            return responseJson({
              protocol: "storybook-package-prepare/1",
              kind: "fallback",
              packageId,
              revision: null,
              revisionUrl: null,
              route: currentRoute.path,
              urlPath: currentRoute.urlPath,
              intent: "reader",
              preview: false,
              initialAppliedRevision: null,
              fallbackRevision: null,
              readerToken: reader.token,
            })
          }
          if (target.kind !== "revision") throw new Error(`Package has no prepared revision: ${packageId}`)
          const viewId = `browser:${randomUUID()}`
          const lease = session.acquireRevisionLease(target.revision, viewId)
          const reader = browserSessions.issue({
            kind: "package",
            packageId,
            revision: target.revision,
            viewId,
            packageGraphDigest: target.graphSnapshot.packageGraphDigest,
            intent: target.intent,
            preview: target.preview,
            release: lease.release,
          })
          return responseJson({
            protocol: "storybook-package-prepare/1",
            kind: "revision",
            packageId,
            revision: target.revision,
            revisionUrl: target.revisionUrl,
            payloadUrl: target.payloadUrl,
            route: target.route.path,
            urlPath: target.route.urlPath,
            intent: target.intent,
            preview: target.preview,
            initialAppliedRevision: target.initialAppliedRevision,
            fallbackRevision: target.fallbackRevision,
            readerToken: reader.token,
            graphSnapshot: target.graphSnapshot,
          })
        }
        if (url.pathname === "/api/browser/confirm-navigation" && request.method === "POST") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
          const grant = browserSessions.authorize(request.headers.get("x-storybook-session") ?? "")
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["route"])
          if (typeof body.route !== "string" || body.route.length > 1_024) throw new Error("Invalid navigation route")
          if (grant.kind !== "package" || grant.intent !== "navigation-candidate" || grant.preview ||
            grant.packageId === null || grant.revision === null) {
            return responseJson({error: "Navigation confirmation is not authorized"}, 403)
          }
          const session = sessions.session(grant.packageId)
          const snapshot = session.snapshot()
          if (snapshot.activeRevision === grant.revision) return responseJson({applied: true})
          const active = snapshot.revisions?.find(record => record.revision === snapshot.activeRevision)
          // Доступная рабочая версия обновляется только явной проверкой.
          if (active?.sharedModuleEpoch !== undefined) return responseJson({applied: false})
          if (snapshot.builtRevision !== grant.revision) throw new Error("Navigation candidate is no longer current")
          server.timeout(request, 0)
          const packages = registry.snapshot().graph.nodes.filter(node => node.kind === "package")
            .map(node => ({packageId: node.packageId!, label: node.label, urlPath: node.urlPath}))
          const views = await browserLifecycle.listViews(server.url.origin, request.signal, packages, grant.packageId)
          for (const view of views) {
            if (view.packageId !== grant.packageId || storybookCurrentRouteKey(view.route) !== body.route) continue
            const evidence = await browserLifecycle.inspect(view.viewId, {include: ["state", "diagnostics", "console"]}, request.signal)
            if (evidence.revision !== grant.revision) continue
            await verifyAndMaybeApplyOpenedCandidate({packageId: grant.packageId, revision: grant.revision}, body.route,
              {...evidence, ok: true, viewId: view.viewId}, request.signal, true)
            return responseJson({applied: true})
          }
          return responseJson({error: "Navigation candidate is not shown in the requested view"}, 409)
        }
        if (url.pathname === "/api/browser/session" && request.method === "POST") {
          assertExternalStorybookRequestOrigin(request, server.url.origin, {required: true})
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["packageId", "preview", "revision"])
          const packageId = requiredText("session packageId", body.packageId)
          const session = sessions.session(packageId)
          const requested = typeof body.revision === "string" ? body.revision : null
          const revision = requested !== null && session.revisionDirectory(requested) !== null
            ? requested : session.snapshot().activeRevision ?? null
          if (body.preview !== undefined && typeof body.preview !== "boolean") {
            throw new Error("Package browser session preview flag must be boolean")
          }
          const preview = body.preview === true
          if (preview && (requested === null || revision !== requested)) {
            throw new Error("Package preview session requires its exact retained revision")
          }
          const snapshot = session.snapshot()
          const intent: StorybookPackageBootstrapIntent = preview
            ? "preview"
            : revision !== null && revision === snapshot.builtRevision && revision !== snapshot.activeRevision
              ? "navigation-candidate"
              : "reader"
          const viewId = `browser:${randomUUID()}`
          const lease = revision === null ? null : session.acquireRevisionLease(revision, viewId)
          const reader = browserSessions.issue({
            kind: "package",
            packageId,
            revision,
            viewId,
            intent,
            preview,
            ...(lease === null ? {} : {release: lease.release}),
          })
          return responseJson({token: reader.token})
        }
        if (url.pathname === "/api/client" && request.method === "GET") {
          const snapshot = registry.snapshot()
          return responseJson(createExternalStorybookClientSnapshot(snapshot.graph, sessions.snapshots(), project.name))
        }
        if (["/api/browser/directory", "/api/control/attach", "/api/browser/attach", "/api/control/detach", "/api/browser/detach"].includes(url.pathname) && request.method === "POST") {
          if (url.pathname.startsWith("/api/browser/")) assertRegistryBrowserRequest(request)
          // TODO: создание Repo, клонирование из GitHub и изменение .gitmodules принадлежат Project.
          return responseJson({ok: false, error: "Состав проекта определяется .gitmodules. Добавление, создание и удаление репозиториев через GitHub ещё не реализованы."}, 501)
        }
        if (url.pathname === "/api/control/refresh" && request.method === "POST") {
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["force"])
          if (body.force !== undefined && typeof body.force !== "boolean") throw new TypeError("refresh force must be boolean")
          const snapshot = await refreshCatalog(body.force !== false)
          return responseJson({
            ok: true,
            registryRevision: snapshot.revision,
            graphDigest: snapshot.graph.digest,
          })
        }
        if (["/api/control/app/web/rebuild", "/api/browser/app/web/rebuild"].includes(url.pathname) && request.method === "POST") {
          server.timeout(request, 0)
          if (url.pathname.startsWith("/api/browser/")) assertRegistryBrowserRequest(request)
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["live"])
          if (body.live !== undefined && typeof body.live !== "boolean") throw new TypeError("live must be boolean")
          if (request.headers.get("accept")?.includes("application/x-ndjson")) {
            return streamAppOperation(request.signal, webProgress, () => rebuildWeb(body.live !== false))
          }
          return responseJson(await rebuildWeb(body.live !== false))
        }
        if (url.pathname === "/api/control/check" && request.method === "POST") {
          server.timeout(request, 0)
          const body = await requestObject(request)
          assertExactRequestKeys(body, ["live", "scope"])
          const scope = body.scope === undefined || body.scope === null
            ? null
            : requiredText("check scope", body.scope)
          if (scope === "storybook:web") {
            if (request.headers.get("accept")?.includes("application/x-ndjson")) {
              return streamAppOperation(request.signal, webProgress, () => rebuildWeb(body.live === true))
            }
            return responseJson(await rebuildWeb(body.live === true))
          }
          if (scope === "storybook:shared") {
            const execute = () => web.check({apply: body.live === true}, request.signal)
            return request.headers.get("accept")?.includes("application/x-ndjson")
              ? streamAppOperation(request.signal, webProgress, execute)
              : responseJson(await execute())
          }
          const selectedPackages = new Set<string>()
          const execute = async () => {
            const refreshed = await refreshCheckCatalog(scope, registry, refreshCatalog, resolveCheckPackages)
            const packageIds = resolveCheckPackages(refreshed, scope)
            for (const packageId of packageIds) selectedPackages.add(packageId)
            // Подготовкой среды и сборкой владеют package sessions, а не HTTP-наблюдатель.
            const results = await Promise.all(packageIds.map((packageId) => sessions.build(packageId, {owner: "check"})))
            let ok = results.every((snapshot) => packageBuildSucceeded(snapshot))
            const views: Readonly<Record<string, unknown>>[] = []
            if (ok && body.live === true && !request.signal.aborted) {
              for (const result of results) {
                const packageId = result.packageId
                const session = sessions.session(packageId)
                const revision = result.builtRevision ?? result.activeRevision ?? null
                try {
                  const packages = registry.snapshot().graph.nodes
                    .filter(node => node.kind === "package")
                    .map(node => ({packageId: node.packageId!, label: node.label, urlPath: node.urlPath}))
                  const existing = (await browserLifecycle.listViews(server.url.origin, request.signal, packages, packageId))
                    .find(view => view.packageId === packageId)
                  const routes = session.revisionGraphSnapshot(revision!)?.routes ?? []
                  const currentRoute = storybookCurrentRouteKey(existing?.route ?? "")
                  const route = routes.some(route => route.path === currentRoute) ? currentRoute : ""
                  let opened: Readonly<Record<string, unknown>>
                  if (existing === undefined) {
                    opened = await openPackageView({packageId, route}, request.signal)
                  } else if (result.builtRevision != null || browserLifecycle.applyRevision !== undefined) {
                    if (browserLifecycle.applyRevision === undefined) throw new Error("Текущий браузерный адаптер не поддерживает HMR")
                    const updated = await browserLifecycle.applyRevision(existing.viewId, revision!, request.signal)
                    opened = Object.freeze({...updated, viewId: existing.viewId, ok: true})
                  } else {
                    const current = await browserLifecycle.inspect(existing.viewId, {include: ["state", "diagnostics", "console"]}, request.signal)
                    opened = Object.freeze({...current, viewId: existing.viewId, ok: true})
                  }
                  await verifyAndMaybeApplyOpenedCandidate(
                    {packageId, revision: revision!},
                    route,
                    opened,
                    request.signal,
                    result.builtRevision != null,
                  )
                  views.push({...opened, package: session.snapshot(), status: "success", applied: true})
                } catch (error) {
                  ok = false
                  const message = error instanceof Error ? error.message : String(error)
                  if (result.builtRevision != null && session.snapshot().builtRevision === result.builtRevision &&
                    !isStorybookNavigationSupersededError(error) &&
                    !message.includes("не поддерживает HMR")) {
                    const activation = session.beginActivation({revision: result.builtRevision, viewId: "agent-check", route: ""})
                    session.failActivation({...activation, diagnostic: storybookDiagnostic("activation", message)})
                  }
                  views.push({packageId, status: "failed", error: {message}})
                  if (request.signal.aborted) break
                }
              }
            }
            return {ok, applied: body.live === true && ok && !request.signal.aborted, graphDigest: registry.snapshot().graph.digest,
              packages: packageIds.map(packageId => sessions.session(packageId).snapshot()), views}
          }
          if (request.headers.get("accept")?.includes("application/x-ndjson")) {
            return streamAppOperation(request.signal, listener => {
              const subscription = eventHub.subscribe(event => {
                if (event.type === "catalog.progress" || event.type === "build.progress" &&
                  event.packageId !== null && selectedPackages.has(event.packageId)) listener(event)
              })
              return () => subscription.close()
            }, execute)
          }
          return responseJson(await execute())
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
          const event = await eventHub.wait((candidate) => {
            if (!packageEventCondition(candidate, packageId, condition, afterRevision)) return false
            const revision = packageCondition(sessions.session(packageId).snapshot(), condition, afterRevision)
            return revision !== null && "revision" in candidate && candidate.revision === revision
          }, {timeoutMs, signal: request.signal})
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
          assertExactRequestKeys(body, ["packageId", "route", "timeoutMs", "recover"])
          if (body.recover !== undefined && typeof body.recover !== "boolean") throw new Error("open recover must be boolean")
          const packageId = requiredText("open packageId", body.packageId)
          const route = body.route === undefined || body.route === ""
            ? ""
            : requiredText("open route", body.route)
          return responseJson(await openPackageView({
            packageId,
            route,
            ...(body.recover === undefined ? {} : {recover: body.recover as boolean}),
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
          if (!existsSync(sharedAssetRoot)) return responseJson({error: "Unknown shared browser asset"}, 404)
          const asset = url.pathname.slice("/__storybook/shared/".length)
          if (asset === "receipt.json" || asset === "candidate.json" || asset.startsWith("hosts/")) return responseJson({error: "Unknown shared browser asset"}, 404)
          return fileInsideResponse(sharedAssetRoot, asset)
        }
        if (url.pathname.startsWith("/assets/workbench-style/") && request.method === "GET") {
          const index = Number(url.pathname.slice("/assets/workbench-style/".length).replace(/\.css$/u, ""))
          const styles = web.readStyleSheets()
          const style = Number.isInteger(index) && index >= 0 ? styles[index] : undefined
          if (style === undefined) return responseJson({error: "Unknown Workbench stylesheet"}, 404)
          return new Response(Bun.file(style.path), {headers: {"content-type": "text/css", "cache-control": "no-store"}})
        }
        if (STORYBOOK_FONT_FACES.some(face => face.src === url.pathname) && request.method === "GET") {
          const name = url.pathname.slice("/assets/".length)
          const fontPath = fileURLToPath(import.meta.resolve(`@zavx0z/engine/fonts/${name}`))
          return fileResponse(fontPath, "font/ttf")
        }
        if (request.method === "GET" && !url.pathname.startsWith("/api/") && url.pathname !== "/") {
          const publicRoute = await resolveStorybookRoute(url.pathname + url.search, registry.snapshot())
          if (publicRoute !== null) {
            server.timeout(request, 0)
            return await packagePageResponse(url, registry, sessions, readSharedAssets, browserSessions, server.url.origin, request.signal, {
              packageId: publicRoute.packageId,
              routePath: publicRoute.route,
            })
          }
        }
        if (request.method === "GET" && (url.pathname.startsWith("/packages/") || registry.snapshot().graph.nodes.some(node =>
          node.kind === "package" && storybookPackageRouteFromPathname(url.pathname, node.packageId!) !== null))) {
          server.timeout(request, 0)
          return await packagePageResponse(url, registry, sessions, readSharedAssets, browserSessions, server.url.origin, request.signal)
        }
        if (request.method === "GET" && url.pathname.startsWith("/browse/")) {
          const segment = url.pathname.slice("/browse/".length).replace(/\/$/u, "")
          const matches = registry.snapshot().graph.nodes.filter(node => node.kind === "package" && storybookPackagePathMatches(segment, node.packageId!))
          if (matches.length !== 1) throw new Error("Unknown or ambiguous package")
          return new Response(null, {status: 308, headers: {location: matches[0]!.urlPath}})
        }
        if (request.method === "GET" && isLandingPath(registry.snapshot(), url.pathname)) {
          return preparingHtmlResponse(async () => {
          await refreshCatalog()
          const assets = readSharedAssets()
          const session = browserSessions.issue({kind: "registry", packageId: null, revision: null})
          const authorStyleSheets = landingWorkbenchAuthorStyleSheets(assets)
          return storybookHtml(
              externalStorybookPageTitle(null),
              `/__storybook/shared/${assets.landingEntry}`,
              "landing",
              session.token,
              null,
              authorStyleSheets,
              null,
              null,
              assets.browserIdentity?.epoch ?? null,
              assets.browserIdentity?.hostModuleEpoch ?? null,
              "reader",
              {kind: "landing", pathname: url.pathname, readerToken: session.token},
          )
          }, htmlResponse("", server.url.origin).headers, request.signal)
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
      async message(websocket, message) {
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
          if (topic.startsWith("chat:")) {
            if (websocket.data.grant.kind !== "registry") throw new Error("Chat subscription requires a registry reader")
            if (websocket.data.subscriptions.has(topic)) return
            const address = topic.slice("chat:".length)
            websocket.data.subscriptions.add(topic)
            try {
              const release = await chat.subscribe(address, snapshot => {
                if (clients.has(websocket)) websocket.send(JSON.stringify({type: "chat.snapshot", address, snapshot}))
              })
              if (clients.has(websocket)) websocket.data.unsubscribers.set(topic, release)
              else release()
            } catch (error) {
              websocket.data.subscriptions.delete(topic)
              throw error
            }
            return
          }
          if (topic !== "registry" && topic !== "catalog" && !topic.startsWith("package:")) {
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
          websocket.send(JSON.stringify({type: "app.web", state: web.read()}))
          if ((topic === "registry" || topic === "catalog" || topic.startsWith("package:")) && canRefreshSharedHost(websocket.data.grant)) {
            try { websocket.send(JSON.stringify(sharedHostEvent(readSharedHost()))) }
            catch { /* Первый явный shared check опубликует готовую оболочку. */ }
          }
          if (topic.startsWith("package:")) {
            const packageId = topic.slice("package:".length)
            const snapshot = sessions.session(packageId).snapshot()
            const active = snapshot.revisions?.find(record => record.revision === snapshot.activeRevision)
            websocket.send(JSON.stringify({type: "package.applied-state", packageId,
              revision: active?.sharedModuleEpoch === undefined ? null : snapshot.activeRevision}))

          }
        } catch (error) {
          if (clients.has(websocket)) websocket.send(JSON.stringify({type: "subscription.failed", message: errorText(error)}))
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
    await Promise.allSettled([chat.dispose(), runScenario.dispose(), web.dispose()])
    await sessions.dispose().catch(() => {})
    unsubscribeBuildProgress()
    browserSessions.dispose()
    eventHub.close()
    stoppedResolve!()
    throw error
  }

  try {
    options.onStartupPhase?.("publication")
    serverRecord = createExternalStorybookServerRecord({
      toolRoot,
      origin: server.url.origin,
      attachedDeclarations: registry.snapshot().entries.map(({declarationPath}) => declarationPath),
    })
    if (options.startLease === undefined) {
      writeServerRecord(statePath, serverRecord)
    } else {
      writeExternalStorybookStartCandidate(options.startLease, serverRecord)
      await waitForStartupPublication(options.startLease, serverRecord, statePath)
    }
    serverRecordCreated = true
    options.onStartupPhase?.("ready")
  } catch (error) {
    await Promise.allSettled([chat.dispose(), runScenario.dispose(), web.dispose()])
    await sessions.dispose().catch(() => {})
    unsubscribeBuildProgress()
    browserSessions.dispose()
    eventHub.close()
    server?.stop(true)
    if (serverRecordCreated) removeOwnedState(statePath, serverRecord)
    stoppedResolve!()
    throw error
  }


  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise
    closePromise = (async () => {
      let chatFailure: unknown
      try { await chat.dispose() } catch (error) { chatFailure = error }
      await runScenario.dispose()
      await web.dispose()
      for (const client of clients) client.close(1001, "Storybook server stopped")
      clients.clear()
          browserSessions.dispose()
      eventHub.close()
      await sessions.dispose()
      unsubscribeBuildProgress()
      server.stop(true)
      removeOwnedState(statePath, serverRecord)
      stoppedResolve!()
      if (chatFailure !== undefined) throw chatFailure
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
    browserLifecycle,
    server,
    stopped,
    stop: close,
  })
}

/** Проецирует immutable CSS той же shared-сборки без запуска self-documentation package. */
function landingWorkbenchAuthorStyleSheets(assets: SharedBrowserAssets): readonly StorybookHtmlAuthorStyleSheet[] {
  if (assets.authorStyleSheets === undefined) throw new Error("Shared browser assets have no attested stylesheets")
  return Object.freeze(assets.authorStyleSheets.map(style => Object.freeze({
    ...style,
    href: `/__storybook/shared/${style.url}`,
  })))
}


/** Точная цель подтверждения из контракта владельца Activation. */
type StorybookActivationCandidate = Pick<ActivationOutput, "packageId" | "revision">

type RegistryEvent = Readonly<{
  type: "catalog.progress"
  state: "running" | "completed" | "failed"
}> | Readonly<{
  type: "registry.updated"
  revision: number
  graphDigest: string
}> | Readonly<{
  type: "registry.failed"
  message: string
}> | Readonly<{
  type: "shared.updated"
  host: StorybookSharedHost
}> | Readonly<{
  type: "shared.failed"
  message: string
}> | (Readonly<{type: "build.progress"}> & StorybookBuildTransition)
  | Readonly<{type: "app.web", state: ReturnType<AppWeb.Output["read"]>}>


async function packagePageResponse(
  url: URL,
  registry: ExternalStorybookRegistry,
  sessions: ExternalStorybookSessionManager,
  readSharedAssets: (preview?: boolean) => SharedBrowserAssets,
  browserSessions: StorybookBrowserSessionRegistry,
  origin: string,
  signal: AbortSignal,
  resolvedRoute?: Readonly<{packageId: string; routePath: string}>,
): Promise<Response> {
  const route = resolvedRoute ?? parsePackageRequest(url.pathname, registry.snapshot().graph.nodes.filter(node => node.kind === "package").map(node => node.packageId!))
  const packageNode = registry.snapshot().graph.nodes.find((node) =>
    node.kind === "package" && node.packageId === route.packageId)
  if (packageNode === undefined) {
    throw new Error(`Unknown Storybook package page title owner: ${route.packageId}`)
  }
  const pageTitle = externalStorybookPageTitle(route.packageId, packageNode.label)
  const session = sessions.session(route.packageId)
  const preview = url.searchParams.get("preview")
  if (!validStorybookViewQuery(url)) throw new Error("Invalid package preview URL")
  const currentRoute = externalStorybookRoutes(registry.snapshot().graph).find(candidate =>
    candidate.packageId === route.packageId && candidate.path === storybookCurrentRouteKey(route.routePath))
  if (preview === null) {
    if (currentRoute === undefined) throw new Error(`Unknown Storybook route: ${route.packageId}:${route.routePath}`)
    signal.throwIfAborted()
  }
  const target = await prepareStorybookPackagePageTarget({
    session,
    routePath: route.routePath,
    previewRevision: preview,
    currentRoute: currentRoute ?? null,
    signal,
  })
  const snapshot = session.snapshot()
  if (target.kind === "redirect-preview") {
    const fallback = new URL(url)
    fallback.searchParams.delete("preview")
    return new Response(null, {status: 308, headers: {location: `${fallback.pathname}${fallback.search}`}})
  }
  if (target.kind === "fallback") {
    if (currentRoute === undefined) throw new Error(`Unknown Storybook route: ${route.packageId}:${route.routePath}`)
    const canonical = canonicalPackageAddress(currentRoute.urlPath, url)
    if (canonical !== `${url.pathname}${url.search}`) return new Response(null, {status: 308, headers: {location: canonical}})
    return preparingHtmlResponse(async () => {
    const assets = readSharedAssets()
    const browserSession = browserSessions.issue({
      kind: "package",
      packageId: route.packageId,
      revision: null,
      intent: target.intent,
      preview: target.preview,
    })
    const authorStyleSheets = landingWorkbenchAuthorStyleSheets(assets)
    return storybookHtml(
        pageTitle,
        `/__storybook/shared/${assets.bootstrapEntry ?? assets.fallbackEntry}`,
        null,
        browserSession.token,
        null,
        authorStyleSheets,
        target.initialAppliedRevision,
        route.packageId,
        assets.browserIdentity?.epoch ?? null,
        assets.browserIdentity?.hostModuleEpoch ?? null,
        target.intent,
        {
          kind: "fallback",
          packageId: route.packageId,
          revision: null,
          revisionUrl: null,
          route: currentRoute.path,
          urlPath: currentRoute.urlPath,
          intent: target.intent,
          preview: false,
          initialAppliedRevision: target.initialAppliedRevision,
          fallbackRevision: null,
          readerToken: browserSession.token,
        },
    )
    }, htmlResponse("", origin).headers, signal)
  }
  const canonical = canonicalPackageAddress(target.route.urlPath, url)
  if (canonical !== `${url.pathname}${url.search}`) {
    return new Response(null, {status: 308, headers: {location: canonical}})
  }
  const viewId = `browser:${randomUUID()}`
  const lease = session.acquireRevisionLease(target.revision, viewId)
  const kernel = snapshot.revisions?.find(record => record.revision === target.revision)?.sharedModuleEpoch
  const shared = readSharedAssets(target.preview || target.intent === "navigation-candidate")
  if (kernel === undefined || shared.bootstrapEntry === undefined) throw new Error("Пакету требуется проверка для текущей оболочки Storybook")
  const script = `/__storybook/shared/${shared.bootstrapEntry}`
  const browserSession = browserSessions.issue({
    kind: "package",
    packageId: route.packageId,
    revision: target.revision,
    viewId,
    packageGraphDigest: target.graphSnapshot.packageGraphDigest,
    intent: target.intent,
    preview: target.preview,
    release: lease.release,
  })
  return htmlResponse(
    storybookHtml(
      externalStorybookPageTitle(route.packageId, target.graphSnapshot.metadata.label),
      script,
      null,
      browserSession.token,
      target.fallbackRevision === target.revision ? null : target.fallbackRevision,
      (kernel === undefined ? target.graphSnapshot.workbenchAuthorStyleSheets : []).map((styleSheet) => Object.freeze({
        ...styleSheet,
        href: `${target.revisionUrl}${styleSheet.url}`,
      })),
      target.initialAppliedRevision,
      route.packageId,
      kernel ?? null,
      null,
      target.intent,
      {
        kind: "revision",
        packageId: route.packageId,
        revision: target.revision,
        revisionUrl: target.revisionUrl,
        payloadUrl: target.payloadUrl,
        route: target.route.path,
        urlPath: target.route.urlPath,
        intent: target.intent,
        preview: target.preview,
        initialAppliedRevision: target.initialAppliedRevision,
        fallbackRevision: target.fallbackRevision,
        readerToken: browserSession.token,
      },
    ),
    origin,
  )
}

/** Сохраняет состояние страницы при переходе к адресу выбранного представления ревизии. */
function canonicalPackageAddress(address: string, current: URL): string {
  const target = new URL(address, current)
  for (const [key, value] of current.searchParams) {
    if (key !== "view") target.searchParams.set(key, value)
  }
  return `${target.pathname}${target.search}`
}

function declarationFailures(snapshot: ExternalStorybookRegistrySnapshot): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  const scopes = new Map(snapshot.catalog.scopes.map(scope => [scope.canonicalId, scope]))
  const mark = (id: string, message: string, descendPackages: boolean): void => {
    const scope = scopes.get(id)
    if (scope?.kind === "package") result.set(scope.id, message)
    const children = scope?.kind === "package" && descendPackages ? scope.packageIds ?? [] : []
    for (const child of children) mark(child, message, true)
  }
  for (const scope of scopes.values()) {
    if (scope.resolutionError !== undefined) mark(scope.canonicalId, scope.resolutionError, scope.kind !== "package")
  }
  return result
}

function parsePackageRequest(pathname: string, packageIds: readonly string[]): Readonly<{packageId: string, routePath: string}> {
  const matches = packageIds.flatMap(packageId => {
    const routePath = storybookPackageRouteFromPathname(pathname, packageId)
    return routePath === null ? [] : [{packageId, routePath}]
  })
  if (matches.length !== 1) throw new Error(`Unknown or ambiguous Storybook package route: ${pathname}`)
  return Object.freeze(matches[0]!)
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
      sourcePath: node.moduleDocumentation?.sourcePath ?? null,
      markdown: node.moduleDocumentation?.markdown ?? "",
    })
  } catch {
    return responseJson({error: "Unknown Storybook resource"}, 404)
  }
  if ([...url.searchParams.keys()].length > 0) throw new Error("Unknown Storybook documentation resource query")
  const overviewPath = node.moduleDocumentation?.sourcePath ?? null
  if (overviewPath === null) return responseJson({error: "Node has no documentation"}, 404)
  if (relativeSegments.length === 0 || relativeSegments.every((segment) => segment.length === 0)) {
    return allowList.resolveSourceFile(overviewPath) === null
      ? responseJson({error: "Unknown documentation source"}, 404)
      : new Response(node.moduleDocumentation!.markdown, {headers: {"content-type": "text/markdown; charset=utf-8"}})
  }
  const decodedSegments = relativeSegments.filter(Boolean).map((segment) => {
    const decoded = decodeURIComponent(segment)
    if (decoded.length === 0 || decoded === "." || decoded === ".." || decoded.includes("\\") ||
      encodeURIComponent(decoded) !== segment) {
      throw new Error(`Unsafe Storybook documentation resource path: ${pathname}`)
    }
    return decoded
  })
  const path = allowList.resolveAsset(
    resolve(dirname(overviewPath), ...decodedSegments),
  )
  return path === null
    ? responseJson({error: "Unknown documentation resource"}, 404)
    : fileResponse(path, contentType(path))
}

function resourceOwnerRoot(snapshot: ExternalStorybookRegistrySnapshot, nodeId: string): string {
  let node = externalStorybookNode(snapshot.graph, nodeId)
  while (node.kind !== "package") {
    if (node.parentId === null) throw new Error(`Storybook resource node has no package owner: ${node.id}`)
    node = externalStorybookNode(snapshot.graph, node.parentId)
  }
  const owner = snapshot.catalog.scopes.find(scope => scope.canonicalId === node.id)
  if (owner === undefined) throw new Error(`Storybook resource node has no catalog owner: ${node.id}`)
  return owner.scopeRoot
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
    (node.kind === "unavailable" || node.kind === "package" || node.kind === "directory" && node.packageId === null) && externalStorybookBrowsePath(node) === pathname)
}

function resolveCheckPackages(
  snapshot: ExternalStorybookRegistrySnapshot,
  scope: string | null,
): readonly string[] {
  const all = snapshot.graph.nodes.filter(({kind}) => kind === "package").map(({packageId}) => packageId!)
  if (scope === "storybook:shared") return Object.freeze([])
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
    const owner = snapshot.catalog.scopes.find(value => value.canonicalId === canonicalId)
    const path = realpathSync(scope)
    return path === entry.declarationPath || path === owner?.scopeRoot
  } catch {
    return false
  }
}

function matchesSubscription(
  subscriptions: ReadonlySet<string>,
  event: StorybookPackageEvent | RegistryEvent,
): boolean {
  if (!("packageId" in event) || event.type === "build.progress" && event.packageId === null) {
    return subscriptions.has("registry") || subscriptions.has("catalog") ||
      ["shared.updated", "shared.failed", "app.web", "build.progress"].includes(event.type) &&
        [...subscriptions].some(topic => topic.startsWith("package:"))
  }
  return subscriptions.has("registry") || subscriptions.has(`package:${event.packageId}`)
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

function sanitizePackageFailure(
  event: Extract<StorybookPackageEvent, {type: "package.failed"}>,
  registry: ExternalStorybookRegistry,
  snapshots: () => ReturnType<ExternalStorybookSessionManager["snapshots"]>,
  projectName: string,
): unknown {
  try {
    const summary = createExternalStorybookClientSnapshot(
      registry.snapshot().graph,
      snapshots(),
      projectName,
    ).packages.find(({packageId}) => packageId === event.packageId)
    return summary === undefined
      ? {type: event.type, packageId: event.packageId, revision: event.revision, diagnostics: []}
      : {type: event.type, packageId: event.packageId, revision: event.revision, diagnostics: summary.diagnostics}
  } catch {
    return {type: event.type, packageId: event.packageId, revision: event.revision, diagnostics: []}
  }
}

function storybookHtml(
  title: string,
  script: string,
  entry: "landing" | null = null,
  browserSessionToken: string,
  fallbackRevision: string | null = null,
  authorStyleSheets: readonly StorybookHtmlAuthorStyleSheet[] = Object.freeze([]),
  appliedRevision: string | null = null,
  packageId: string | null = null,
  sharedModuleEpoch: string | null = null,
  hostModuleEpoch: string | null = null,
  bootstrapIntent: StorybookPackageBootstrapIntent = "reader",
  pageTarget: Readonly<Record<string, unknown>> | null = null,
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
    <meta name="external-storybook-package-id" content="${escapeHtml(packageId ?? "")}">
    <meta name="external-storybook-shared-module-epoch" content="${escapeHtml(sharedModuleEpoch ?? "")}">
    <meta name="external-storybook-host-module-epoch" content="${escapeHtml(hostModuleEpoch ?? "")}">
    <meta name="external-storybook-bootstrap-intent" content="${escapeHtml(bootstrapIntent)}">
    <meta name="external-storybook-applied-revision" content="${escapeHtml(appliedRevision ?? "")}">
    ${fallbackRevision === null ? "" : `<meta name="external-storybook-fallback-revision" content="${escapeHtml(fallbackRevision)}">`}
${styleSheetLinks.length === 0 ? "" : `${styleSheetLinks}\n`}
    <title>${escapeHtml(title)}</title>
    <style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#111}#external-storybook-canvas{display:block;width:100%;height:100%;touch-action:none}</style>
  </head>
  <body>
    <canvas id="external-storybook-canvas" aria-label="Storybook Workbench"></canvas>
    ${pageTarget === null ? "" : `<script type="application/json" id="external-storybook-page-target">${JSON.stringify(pageTarget).replaceAll("<", "\\u003c")}</script>`}
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
        `connect-src 'self' data: blob: ${websocket.origin}`,
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

async function requestObject(request: Request, maxBytes = STORYBOOK_CONTROL_BODY_MAX_BYTES): Promise<Record<string, unknown>> {
  const contentLength = request.headers.get("content-length")
  if (contentLength !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) ||
    Number(contentLength) > maxBytes)) {
    throw new StorybookRequestError(413, "Storybook request body is too large")
  }
  const source = await boundedRequestText(request, maxBytes)
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
  if (/Unknown|not found|does not exist|has no documentation/iu.test(message)) return 404
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
