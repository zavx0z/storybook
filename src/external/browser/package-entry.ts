/** One package-tab realm driven by generated literal runtime/story loaders. */

import type {CustomEvent, Node as SemanticNode} from "@zavx0z/dom"
import {STORYBOOK_DOM_WORKBENCH_EVENTS} from "../../dom/workbench.ts"
import {createStorybookAgentBridge, type StorybookAgentBridge} from "./agent-bridge.ts"
import {
  validateStorybookRuntimeAdapter,
  validateStorybookRuntimeSession,
  type StorybookRuntimeContext,
  type StorybookRuntimeSession,
  type StorybookWorldPreview,
} from "../runtime-protocol.ts"
import {
  decodeExternalStorybookPackagePath,
  encodeExternalStorybookPackagePath,
  EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
  type ExternalStorybookClientPackageSummary,
  type ExternalStorybookClientSnapshot,
} from "./client-protocol.ts"
import {
  validateStorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionGraphSnapshot,
} from "../package-revision.ts"
import {
  deriveExternalStorybookPackageTab,
  type ExternalStorybookBrowserNavigationItem,
  type ExternalStorybookBrowserVariantItem,
  type ExternalStorybookPackageTabModel,
} from "./model.ts"
import {
  createExternalStorybookShell,
  externalStorybookClientNode,
  fetchExternalStorybookClientSnapshot,
  readExternalStorybookNodeReadme,
  type CreateExternalStorybookShellOptions,
  type ExternalStorybookShell,
} from "./shell.ts"

export type ExternalStorybookStoryLoader = () => Promise<unknown>
export type ExternalStorybookRuntimeLoader = (() => Promise<unknown>) | null

type ExternalStorybookSocket = Readonly<{
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  send(data: string): void
  close(): void
}>

export type ExternalStorybookPackageEnvironment = Readonly<{
  fetcher?: typeof fetch
  browserDocument?: globalThis.Document
  location?: Pick<Location, "pathname" | "href" | "reload">
  history?: Pick<History, "pushState" | "replaceState">
  createSocket?(url: string): ExternalStorybookSocket
  /** Focused test seam; production waits on the renderer-presented frame sequence. */
  waitForFrame?(): Promise<void>
  shell?: Omit<CreateExternalStorybookShellOptions, "title" | "browserDocument">
  acknowledgeActivation?(input: Readonly<{
    packageId: string
    revision: string
    packageGraphDigest: string
    route: string
    frameSequence: number
    working: boolean
    diagnostic?: string
  }>): Promise<void>
  /** Focused lifecycle cancellation seam; browser production also uses pagehide. */
  lifecycleSignal?: AbortSignal
  /** Focused cleanup seam; production bounds uncooperative owner cleanup. */
  cleanupTimeoutMs?: number
}>

export type StartExternalStorybookPackageInput = Readonly<{
  packageId: string
  candidateRevision: string | null
  revisionUrl: string | null
  loadRuntime: ExternalStorybookRuntimeLoader
  storyLoaders: ReadonlyMap<string, ExternalStorybookStoryLoader>
  graphSnapshot?: StorybookPackageRevisionGraphSnapshot
  environment?: ExternalStorybookPackageEnvironment
}>

export type ExternalStorybookPackageController = Readonly<{
  snapshot: ExternalStorybookClientSnapshot
  shell: ExternalStorybookShell
  get currentRoute(): string
  navigate(route: string): Promise<void>
  dispose(): Promise<void>
}>

export async function startExternalStorybookPackage(
  input: StartExternalStorybookPackageInput,
): Promise<ExternalStorybookPackageController> {
  const packageId = exactPackageId(input.packageId)
  const candidateRevision = input.candidateRevision === null ? null : safeRevision(input.candidateRevision)
  validateRevisionUrl(packageId, candidateRevision, input.revisionUrl)
  const storyLoaders = validateStoryLoaders(input.storyLoaders)
  if (input.loadRuntime !== null && typeof input.loadRuntime !== "function") {
    throw new TypeError("External Storybook runtime loader must be a function or null")
  }
  const environment = input.environment ?? {}
  const browserDocument = environment.browserDocument ?? globalThis.document
  const location = environment.location ?? globalThis.location
  const history = environment.history ?? globalThis.history
  if (browserDocument === undefined || location === undefined || history === undefined) {
    throw new Error("External Storybook package browser environment is unavailable")
  }
  if (browserDocument.defaultView !== null && browserDocument.defaultView !== undefined) {
    browserDocument.defaultView.name = `storybook:${packageId}`
  }
  browserDocument.documentElement.dataset.externalStorybook = "starting"
  browserDocument.documentElement.dataset.externalStorybookPackage = "starting"
  browserDocument.documentElement.dataset.externalStorybookPackageId = packageId
  browserDocument.documentElement.dataset.externalStorybookRevision = candidateRevision ?? "unavailable"
  browserDocument.documentElement.dataset.externalStorybookPhase = "snapshot"

  const fetcher = environment.fetcher ?? globalThis.fetch
  const bootstrap = await (async () => {
    try {
      const snapshot = input.graphSnapshot === undefined
        ? await fetchExternalStorybookClientSnapshot(fetcher)
        : revisionClientSnapshot(input.graphSnapshot, candidateRevision, input.revisionUrl)
      const summary = exactPackageSummary(snapshot, packageId)
      if (candidateRevision !== null &&
        summary.builtRevision !== candidateRevision && summary.activatingRevision !== candidateRevision &&
        summary.activeRevision !== candidateRevision && summary.lastWorkingRevision !== candidateRevision) {
        throw new Error(`External Storybook revision is not active or last-good, built, activating, or last-working: ${candidateRevision}`)
      }
      if (candidateRevision === null && (input.loadRuntime !== null || storyLoaders.size > 0)) {
        throw new Error(`Unavailable Storybook package cannot receive executable loaders: ${packageId}`)
      }
      for (const [route, loader] of storyLoaders) {
        if (typeof loader !== "function") throw new TypeError(`External Storybook story loader is not callable: ${route}`)
        const model = deriveExternalStorybookPackageTab(snapshot, packageId, route)
        if (model.selectedNode.kind !== "variant") {
          throw new Error(`External Storybook story loader route is not a variant: ${route}`)
        }
      }
      const initialRoute = packageRouteFromPathname(location.pathname, packageId)
      return Object.freeze({
        snapshot,
        summary,
        graph: snapshot,
        initialRoute,
        initialModel: deriveExternalStorybookPackageTab(snapshot, packageId, initialRoute),
      })
    } catch (error) {
      browserDocument.documentElement.dataset.externalStorybook = "error"
      browserDocument.documentElement.dataset.externalStorybookPackage = "error"
      browserDocument.documentElement.dataset.externalStorybookPhase = "error"
      browserDocument.documentElement.dataset.externalStorybookError = errorText(error).slice(0, 2_048)
      throw error
    }
  })()
  const {snapshot, summary, graph, initialRoute, initialModel} = bootstrap
  browserDocument.documentElement.dataset.externalStorybookPhase = "shell"
  const shell = await createExternalStorybookShell({
    title: `${packageId} · Storybook`,
    browserDocument,
    ...(environment.shell ?? {}),
  })
  const lifetime = new AbortController()
  let routeAbort = new AbortController()
  let session: StorybookRuntimeSession | null = null
  let sessionPromise: Promise<StorybookRuntimeSession> | null = null
  let mountedRoute: string | null = null
  let currentRoute = initialRoute
  let currentModel = initialModel
  let contextRevision = 0
  let navigationRevision = 0
  let operationTail: Promise<void> = Promise.resolve()
  let disposePromise: Promise<void> | null = null
  let agentBridge: StorybookAgentBridge | null = null
  let activeWorldPreview: StorybookWorldPreview | null = null
  let reloadingFallback = false
  let disposed = false

  const disposeWorldPreview = (): void => {
    const preview = activeWorldPreview
    activeWorldPreview = null
    preview?.dispose()
  }

  const context: StorybookRuntimeContext = Object.freeze({
    document: shell.document,
    browserDocument,
    canvas: shell.canvas,
    signal: lifetime.signal,
    mount(node: SemanticNode) {
      if (contextRevision !== navigationRevision || routeAbort.signal.aborted) {
        throw new Error("External Storybook runtime attempted a stale mount")
      }
      disposeWorldPreview()
      shell.mountPreview(currentModel.selectedNode.label, node)
    },
    publishInspector(value) {
      shell.publishInspector(value)
    },
    publishSource(value) {
      shell.publishSource(value)
    },
    publishProps(value) {
      shell.publishProps(value)
    },
    reportDiagnostic(value) {
      shell.reportDiagnostic(value)
    },
    requestRender() {
      shell.requestRender()
    },
    subscribePreviewBounds(listener) {
      return shell.subscribePreviewBounds(listener)
    },
    mountWorldPreview(registration) {
      if (contextRevision !== navigationRevision || routeAbort.signal.aborted) {
        throw new Error("External Storybook runtime attempted a stale world mount")
      }
      disposeWorldPreview()
      const preview = shell.mountWorldPreview(currentModel.selectedNode.label, registration)
      activeWorldPreview = preview
      return preview
    },
  })

  const ensureSession = async (): Promise<StorybookRuntimeSession> => {
    if (session !== null) return session
    if (sessionPromise !== null) return sessionPromise
    if (input.loadRuntime === null) throw new Error(`Executable Storybook variant has no runtime: ${packageId}`)
    const pending = Promise.resolve()
      .then(() => input.loadRuntime!())
      .then(validateStorybookRuntimeAdapter)
      .then((adapter) => adapter.create(context))
      .then(async (candidate) => {
        let created: StorybookRuntimeSession
        try {
          created = validateStorybookRuntimeSession(candidate)
        } catch (error) {
          await bestEffortDispose(candidate)
          throw error
        }
        if (disposed || lifetime.signal.aborted) {
          await created.dispose()
          throw lifetime.signal.reason ?? new DOMException("Aborted", "AbortError")
        }
        try {
          await shell.setOwnerStyleSheets(created.styleSheets ?? Object.freeze([]))
        } catch (error) {
          await created.dispose()
          throw error
        }
        if (disposed || lifetime.signal.aborted) {
          await created.dispose()
          throw lifetime.signal.reason ?? new DOMException("Aborted", "AbortError")
        }
        session = created
        return created
      })
      .finally(() => {
        if (sessionPromise === pending) sessionPromise = null
      })
    sessionPromise = pending
    return pending
  }

  const showOverview = async (
    model: ExternalStorybookPackageTabModel,
    revision: number,
  ): Promise<void> => {
    disposeWorldPreview()
    if (session !== null && mountedRoute !== null) {
      await session.unmount()
      mountedRoute = null
    }
    const node = externalStorybookClientNode(snapshot, model.selectedNode.id)
    const readme = await readExternalStorybookNodeReadme(node, fetcher)
    if (disposed || revision !== navigationRevision) return
    if (readme === null) {
      shell.showMessage(`${node.label} · Обзор`, node.label, overviewDescription(node.kind, node.childIds.length))
    } else {
      shell.showMarkdown(`${node.label} · README`, readme, node.resourceUrl)
    }
  }

  const showVariant = async (
    model: ExternalStorybookPackageTabModel,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> => {
    const route = model.selectedNode.routePath
    if (route === null) throw new Error(`External Storybook variant has no route: ${model.selectedNode.id}`)
    const loader = storyLoaders.get(route)
    if (loader === undefined) {
      await showOverview(model, revision)
      return
    }
    contextRevision = revision
    disposeWorldPreview()
    shell.showMessage(`${model.selectedNode.label} · Загрузка`, model.selectedNode.label, "Загрузка owner story…")
    const [runtimeSession, story] = await abortable(Promise.all([ensureSession(), loader()]), signal)
    if (disposed || revision !== navigationRevision || signal.aborted) return
    const storyInput = Object.freeze({route, story, signal})
    if (mountedRoute === route && runtimeSession.update !== undefined) {
      await abortable(Promise.resolve(runtimeSession.update(storyInput)), signal)
      if (disposed || revision !== navigationRevision || signal.aborted) return
    } else {
      if (mountedRoute !== null) await abortable(Promise.resolve(runtimeSession.unmount()), signal)
      if (disposed || revision !== navigationRevision || signal.aborted) return
      await abortable(Promise.resolve(runtimeSession.mount(storyInput)), signal)
      if (disposed || revision !== navigationRevision || signal.aborted) {
        await runtimeSession.unmount()
        disposeWorldPreview()
        return
      }
      mountedRoute = route
    }
  }

  const applyRoute = async (
    route: string,
    revision: number,
    signal: AbortSignal,
    failActivation = false,
  ): Promise<void> => {
    if (disposed) throw new Error("External Storybook package tab is disposed")
    const model = deriveExternalStorybookPackageTab(graph, packageId, route)
    if (revision !== navigationRevision || signal.aborted) return
    currentRoute = route
    currentModel = model
    browserDocument.documentElement.dataset.externalStorybookPackage = "starting"
    browserDocument.documentElement.dataset.externalStorybookRoute = route
    applyModel(shell, model)
    shell.clearDiagnostics()
    for (const diagnostic of summary.diagnostics) shell.reportDiagnostic(diagnostic)
    try {
      if (candidateRevision === null && summary.buildState === "failed") {
        throw new Error(summary.diagnostics.map(({message}) => message).join("\n") ||
          `Package ${packageId} has no last-good revision`)
      }
      if (model.selectedNode.kind === "variant") {
        await showVariant(model, revision, signal)
      } else {
        await showOverview(model, revision)
      }
      if (disposed || revision !== navigationRevision || signal.aborted) return
      shell.updateStatus(`${packageId} · ${route.length === 0 ? "overview" : route}`)
      const beforeFrame = shell.presentedFrameSequence
      if (environment.waitForFrame !== undefined) await environment.waitForFrame()
      else {
        const frameSequence = shell.presentFrame()
        if (frameSequence <= beforeFrame) throw new Error("Storybook activation did not present a new frame")
      }
      if (disposed || revision !== navigationRevision || signal.aborted) return
      browserDocument.documentElement.dataset.externalStorybook = "ready"
      browserDocument.documentElement.dataset.externalStorybookPackage = "ready"
    } catch (error) {
      if (disposed || revision !== navigationRevision) return
      isolatePackageError(browserDocument, shell, model, error)
      if (failActivation) throw error
    }
  }

  const scheduleRoute = (route: string, failActivation = false): Promise<void> => {
    assertActive(disposed)
    const model = deriveExternalStorybookPackageTab(graph, packageId, route)
    if (location.pathname !== model.selectedNode.urlPath) {
      history.pushState(null, "", model.selectedNode.urlPath)
    }
    const revision = ++navigationRevision
    routeAbort.abort()
    routeAbort = new AbortController()
    const signal = routeAbort.signal
    const operation = operationTail
      .catch(() => {})
      .then(async () => {
        await applyRoute(route, revision, signal, failActivation)
        if (disposed) throw lifetime.signal.reason ?? new DOMException("Aborted", "AbortError")
      })
    operationTail = operation.catch(() => {})
    return operation
  }
  const navigate = async (route: string): Promise<void> => {
    await scheduleRoute(route)
  }
  const onNavigate = (event: unknown): void => {
    const route = (event as CustomEvent<{route: string}>).detail.route
    void navigate(route).catch((error) => isolatePackageError(browserDocument, shell, currentModel, error))
  }
  const onScenario = (event: unknown): void => {
    const id = (event as CustomEvent<{id: string}>).detail.id
    const item = currentModel.variants.find((variant) => variant.id === id)
    if (item === undefined) {
      isolatePackageError(browserDocument, shell, currentModel, new Error(`Unknown Storybook variant item: ${id}`))
      return
    }
    void navigate(item.route).catch((error) => isolatePackageError(browserDocument, shell, currentModel, error))
  }
  const onPopState = (): void => {
    try {
      const route = packageRouteFromPathname(location.pathname, packageId)
      void scheduleRoute(route)
    } catch (error) {
      isolatePackageError(browserDocument, shell, currentModel, error)
    }
  }
  shell.workbench.element.addEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.navigate, onNavigate)
  shell.workbench.element.addEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.scenario, onScenario)
  globalThis.addEventListener?.("popstate", onPopState)

  const socket = createPackageSocket(
    environment,
    location.href,
    readBrowserSessionToken(browserDocument),
  )
  const onSocketOpen = (): void => {
    socket.send(JSON.stringify({type: "subscribe", topic: `package:${packageId}`}))
  }
  const onSocketMessage = (event: MessageEvent): void => {
    const update = parsePackageEvent(event.data)
    if (update === null || update.packageId !== packageId) return
    if (update.type === "package.built") {
      if (update.revision !== candidateRevision) location.reload()
      return
    }
    if (update.type === "package.updated") {
      if (update.revision !== candidateRevision) location.reload()
      return
    }
    if (update.type === "package.resources-updated" || update.type === "package.metadata-updated") {
      shell.updateStatus(`${packageId} · ${update.type}`)
      return
    }
    if (update.type === "package.code-updated") return
    if (update.type === "package.failed") {
      const fallbackRevision = readMetaContent(browserDocument, "external-storybook-fallback-revision")
      if (update.revision === candidateRevision && fallbackRevision !== undefined &&
        fallbackRevision !== candidateRevision && !reloadingFallback) {
        reloadingFallback = true
        const reason = new Error(`Storybook candidate activation failed: ${candidateRevision}`)
        routeAbort.abort(reason)
        void dispose(reason)
        location.reload()
        return
      }
      for (const diagnostic of update.diagnostics) shell.reportDiagnostic(diagnostic)
      shell.updateStatus(`${packageId} · last-good · build failed`)
      return
    }
    shell.reportDiagnostic(`Package detached: ${packageId}`)
    shell.updateStatus(`${packageId} · detached`)
  }
  socket.addEventListener("open", onSocketOpen)
  socket.addEventListener("message", onSocketMessage)

  const dispose = async (reason?: unknown): Promise<void> => {
    if (disposePromise !== null) return disposePromise
    disposed = true
    navigationRevision += 1
    lifetime.abort(reason)
    routeAbort.abort()
    socket.removeEventListener("open", onSocketOpen)
    socket.removeEventListener("message", onSocketMessage)
    socket.close()
    globalThis.removeEventListener?.("popstate", onPopState)
    globalThis.removeEventListener?.("pagehide", onPageHide)
    environment.lifecycleSignal?.removeEventListener("abort", onPageHide)
    shell.workbench.element.removeEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.navigate, onNavigate)
    shell.workbench.element.removeEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.scenario, onScenario)
    const cleanupTimeoutMs = boundedCleanupTimeout(environment.cleanupTimeoutMs ?? 5_000)
    disposePromise = (async () => {
      try {
        const deadline = Date.now() + cleanupTimeoutMs
        await settleBefore(operationTail, deadline)
        if (sessionPromise !== null) await settleBefore(sessionPromise, deadline)
        if (session !== null) {
          disposeWorldPreview()
          if (mountedRoute !== null) await settleBefore(Promise.resolve(session.unmount()), deadline)
          await settleBefore(Promise.resolve(session.dispose()), deadline)
        }
      } finally {
        agentBridge?.dispose()
        shell.dispose()
      }
    })()
    return disposePromise
  }
  const onPageHide = (): void => { void dispose(environment.lifecycleSignal?.reason) }
  globalThis.addEventListener?.("pagehide", onPageHide, {once: true})
  environment.lifecycleSignal?.addEventListener("abort", onPageHide, {once: true})
  if (environment.lifecycleSignal?.aborted === true) onPageHide()

  const canonicalInitial = currentModel.selectedNode.urlPath
  if (location.pathname !== canonicalInitial) history.replaceState(null, "", canonicalInitial)
  try {
    browserDocument.documentElement.dataset.externalStorybookPhase = "route"
    await scheduleRoute(currentRoute, true)
    browserDocument.documentElement.dataset.externalStorybookPhase = "bridge"
    agentBridge = createStorybookAgentBridge({
      packageId,
      revision: candidateRevision ?? "unavailable",
      graphDigest: snapshot.graphDigest,
      shell,
      getRoute: () => currentRoute,
      getModel: () => currentModel,
      navigate,
    })
    if (candidateRevision !== null) {
      browserDocument.documentElement.dataset.externalStorybookPhase = "activation"
      await acknowledgeActivation(environment, browserDocument, {
        packageId,
        revision: candidateRevision,
        packageGraphDigest: snapshot.graphDigest,
        route: currentRoute,
        frameSequence: shell.presentedFrameSequence,
        working: true,
      })
    }
    browserDocument.documentElement.dataset.externalStorybookPhase = "ready"
  } catch (error) {
    browserDocument.documentElement.dataset.externalStorybookPhase = "error"
    if (disposed) {
      await dispose(environment.lifecycleSignal?.reason)
      throw lifetime.signal.reason ?? error
    }
    if (candidateRevision !== null) {
      try {
        await acknowledgeActivation(environment, browserDocument, {
          packageId,
          revision: candidateRevision,
          packageGraphDigest: snapshot.graphDigest,
          route: currentRoute,
          frameSequence: shell.presentedFrameSequence,
          working: false,
          diagnostic: errorText(error),
        })
        const fallbackRevision = readMetaContent(browserDocument, "external-storybook-fallback-revision")
        if (fallbackRevision !== undefined && fallbackRevision !== candidateRevision) {
          browserDocument.documentElement.dataset.externalStorybookPhase = "fallback"
          reloadingFallback = true
          location.reload()
        }
      } catch {
        // The isolated candidate error remains visible when acknowledgement itself fails.
      }
    }
    if (!reloadingFallback) {
      agentBridge ??= createStorybookAgentBridge({
        packageId,
        revision: candidateRevision ?? "unavailable",
        graphDigest: snapshot.graphDigest,
        shell,
        getRoute: () => currentRoute,
        getModel: () => currentModel,
        navigate,
      })
    }
  }

  return Object.freeze({
    snapshot,
    shell,
    get currentRoute() {
      return currentRoute
    },
    navigate,
    dispose,
  })
}

function applyModel(shell: ExternalStorybookShell, model: ExternalStorybookPackageTabModel): void {
  shell.document.transaction(() => {
    shell.workbench.update("catalog.label", model.packageNode.label)
    shell.workbench.update("catalog.items", navigationItems(model.catalogItems))
    shell.workbench.update("catalog.active", model.catalogActiveId)
    shell.workbench.update("secondary.label", "Предметы")
    shell.workbench.update("secondary.items", navigationItems(model.secondaryItems))
    shell.workbench.update("secondary.active", model.secondaryActiveId)
    shell.workbench.update("scenarios.label", "Варианты")
    shell.workbench.update("scenarios.items", variantItems(model.variants))
    shell.workbench.update("scenarios.active", model.variantActiveId)
  })
}

function navigationItems(items: readonly ExternalStorybookBrowserNavigationItem[]) {
  return Object.freeze(items.map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    route: item.route,
    title: item.title,
    searchText: item.searchText,
    ...(item.group === null ? {} : {group: item.group}),
  })))
}

function variantItems(items: readonly ExternalStorybookBrowserVariantItem[]) {
  return Object.freeze(items.map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    title: item.group === null ? item.title : `${item.group.label} · ${item.title}`,
  })))
}

function packageRouteFromPathname(pathname: string, packageId: string): string {
  const segments = pathname.split("/")
  if (segments[0] !== "" || segments[1] !== "packages" || segments[2] === undefined) {
    throw new Error(`External Storybook package pathname is malformed: ${pathname}`)
  }
  const pathnamePackage = decodeExternalStorybookPackagePath(segments[2])
  if (pathnamePackage !== packageId) {
    throw new Error(`External Storybook package pathname belongs to ${pathnamePackage}, expected ${packageId}`)
  }
  const encodedRoute = segments.slice(3)
  if (encodedRoute.at(-1) === "") encodedRoute.pop()
  if (encodedRoute.some((segment) => segment.length === 0)) {
    throw new Error(`External Storybook package pathname is malformed: ${pathname}`)
  }
  return encodedRoute.map((segment) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch (error) {
      throw new Error(`External Storybook route segment is malformed: ${segment}`, {cause: error})
    }
    if (encodeURIComponent(decoded) !== segment) {
      throw new Error(`External Storybook route segment is not canonical: ${segment}`)
    }
    return decoded
  }).join("/")
}

function revisionClientSnapshot(
  value: StorybookPackageRevisionGraphSnapshot,
  revision: string | null,
  revisionBase: string | null,
): ExternalStorybookClientSnapshot {
  const graph = validateStorybookPackageRevisionGraphSnapshot(value)
  return Object.freeze({
    protocol: EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
    graphDigest: graph.packageGraphDigest,
    rootIds: Object.freeze([graph.rootId]),
    nodes: Object.freeze(graph.nodes.map((node) => Object.freeze({
      ...node,
      resourceUrl: revisionBase === null ? node.resourceUrl : `${revisionBase}${node.resourceUrl}`,
    }))),
    packages: Object.freeze([Object.freeze({
      packageId: graph.packageId,
      declarationDigest: graph.declarationDigest,
      moduleGraphRevision: null,
      candidateRevision: null,
      builtRevision: revision,
      activatingRevision: null,
      activeRevision: null,
      lastWorkingRevision: null,
      lastGoodRevision: null,
      buildState: revision === null ? "idle" as const : "built" as const,
      diagnostics: Object.freeze([]),
    })]),
  })
}

function exactPackageSummary(
  snapshot: ExternalStorybookClientSnapshot,
  packageId: string,
): ExternalStorybookClientPackageSummary {
  const matches = snapshot.packages.filter((summary) => summary.packageId === packageId)
  if (matches.length === 0) throw new Error(`External Storybook client has no package summary: ${packageId}`)
  if (matches.length > 1) throw new Error(`External Storybook client package summary is ambiguous: ${packageId}`)
  return matches[0]!
}

function validateStoryLoaders(
  value: ReadonlyMap<string, ExternalStorybookStoryLoader>,
): ReadonlyMap<string, ExternalStorybookStoryLoader> {
  if (!(value instanceof Map)) throw new TypeError("External Storybook storyLoaders must be a Map")
  return value
}

function createPackageSocket(
  environment: ExternalStorybookPackageEnvironment,
  href: string,
  sessionToken?: string,
): ExternalStorybookSocket {
  const url = new URL("/api/events", href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  if (sessionToken !== undefined) url.searchParams.set("session", sessionToken)
  return environment.createSocket?.(url.href) ?? new WebSocket(url.href)
}

function parsePackageEvent(value: unknown): any | null {
  if (typeof value !== "string") return null
  let event: unknown
  try {
    event = JSON.parse(value)
  } catch {
    return null
  }
  if (event === null || typeof event !== "object" || !("type" in event) || !("packageId" in event)) return null
  const record = event as Record<string, unknown>
  if (record.type === "package.updated" && typeof record.packageId === "string" && typeof record.revision === "string") {
    return {type: record.type, packageId: record.packageId, revision: record.revision}
  }
  if (record.type === "package.built" && typeof record.packageId === "string" && typeof record.revision === "string") {
    return {type: record.type, packageId: record.packageId, revision: record.revision}
  }
  if (["package.code-updated", "package.resources-updated", "package.metadata-updated"].includes(String(record.type)) &&
    typeof record.packageId === "string" && typeof record.path === "string") {
    return {type: record.type, packageId: record.packageId, path: record.path}
  }
  if (record.type === "package.failed" && typeof record.packageId === "string" &&
    typeof record.revision === "string" && Array.isArray(record.diagnostics)) {
    return {type: record.type, packageId: record.packageId, revision: record.revision, diagnostics: record.diagnostics}
  }
  if (record.type === "package.detached" && typeof record.packageId === "string") {
    return {type: record.type, packageId: record.packageId}
  }
  return null
}

function validateRevisionUrl(packageId: string, revision: string | null, value: string | null): void {
  if (revision === null) {
    if (value !== null) throw new Error(`Unavailable Storybook revision URL must be null: ${String(value)}`)
    return
  }
  const expected = `/__storybook/revisions/${encodeURIComponent(packageId)}/${revision}/`
  if (value !== expected) throw new Error(`External Storybook revision URL mismatch: ${value}`)
}

function exactPackageId(value: string): string {
  encodeExternalStorybookPackagePath(value)
  return value
}

function safeRevision(value: string): string {
  if (typeof value !== "string" || value.length === 0 || /[^a-zA-Z0-9._-]/u.test(value)) {
    throw new Error(`Invalid external Storybook revision: ${String(value)}`)
  }
  return value
}

function overviewDescription(kind: string, children: number): string {
  if (kind === "package") return `${children} категорий. Выберите категорию слева.`
  if (kind === "category") return `${children} предметов. Выберите предмет во второй панели.`
  if (kind === "subject") return `${children} вариантов. Выберите вариант в нижней панели.`
  return "Documentation-only variant."
}

function isolatePackageError(
  document: globalThis.Document,
  shell: ExternalStorybookShell,
  model: ExternalStorybookPackageTabModel,
  error: unknown,
): void {
  const message = errorText(error)
  document.documentElement.dataset.externalStorybookPackage = "error"
  document.documentElement.dataset.externalStorybookError = message
  shell.reportDiagnostic(message)
  shell.showMessage(`${model.selectedNode.label} · Ошибка`, model.selectedNode.label, message)
  shell.updateStatus(`${model.packageNode.ownerId} · isolated error`)
  console.error(error)
}

async function acknowledgeActivation(
  environment: ExternalStorybookPackageEnvironment,
  browserDocument: globalThis.Document,
  input: Readonly<{
    packageId: string
    revision: string
    packageGraphDigest: string
    route: string
    frameSequence: number
    working: boolean
    diagnostic?: string
  }>,
): Promise<void> {
  if (environment.acknowledgeActivation !== undefined) {
    await environment.acknowledgeActivation(input)
    return
  }
  const activationId = readMetaContent(browserDocument, "external-storybook-activation-id")
  const sessionToken = readBrowserSessionToken(browserDocument)
  if (activationId === undefined || sessionToken === undefined) return
  const response = await (environment.fetcher ?? globalThis.fetch)("/api/browser/activation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-storybook-session": sessionToken,
    },
    body: JSON.stringify({...input, activationId}),
  })
  if (!response.ok) throw new Error(`Storybook activation acknowledgement failed: ${response.status}`)
}

function readBrowserSessionToken(browserDocument: globalThis.Document): string | undefined {
  const value = readMetaContent(browserDocument, "external-storybook-browser-session")
  return value === undefined || value.length === 0 ? undefined : value
}

function readMetaContent(browserDocument: globalThis.Document, name: string): string | undefined {
  return typeof browserDocument.querySelector === "function"
    ? browserDocument.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content
    : undefined
}

async function bestEffortDispose(value: unknown): Promise<void> {
  if (value === null || typeof value !== "object") return
  let dispose: unknown
  try {
    dispose = (value as {dispose?: unknown}).dispose
  } catch {
    return
  }
  if (typeof dispose !== "function") return
  try {
    await dispose.call(value)
  } catch {
    // The original validation/create error remains authoritative.
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function abortable<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
  return new Promise<Value>((resolvePromise, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      callback()
    }
    const onAbort = (): void => finish(() => reject(signal.reason ?? new DOMException("Aborted", "AbortError")))
    signal.addEventListener("abort", onAbort, {once: true})
    promise.then(
      (value) => finish(() => resolvePromise(value)),
      (error) => finish(() => reject(error)),
    )
  })
}

async function settleBefore(promise: Promise<unknown>, deadline: number): Promise<void> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return
  await Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, remaining)),
  ])
}

function boundedCleanupTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 30_000) {
    throw new RangeError("Storybook cleanup timeout must be between 10 and 30000 ms")
  }
  return value
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("External Storybook package tab is disposed")
}

if (typeof document !== "undefined" && document.documentElement.dataset.externalStorybookEntry === "package") {
  // Generated immutable entries call startExternalStorybookPackage with their
  // literal loaders. A bare source module deliberately has nothing to start.
}
