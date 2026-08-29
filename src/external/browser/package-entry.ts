/** One package-tab realm driven by generated literal runtime/story loaders. */

import type {CustomEvent, Node as SemanticNode} from "@zavx0z/dom"
import {STORYBOOK_DOM_WORKBENCH_EVENTS} from "../../dom/workbench.ts"
import {waitForStorybookFrameBoundary} from "./frame.ts"
import {
  validateStorybookRuntimeAdapter,
  validateStorybookRuntimeSession,
  type StorybookRuntimeContext,
  type StorybookRuntimeSession,
} from "../runtime-protocol.ts"
import {
  decodeExternalStorybookPackagePath,
  encodeExternalStorybookPackagePath,
  type ExternalStorybookClientPackageSummary,
  type ExternalStorybookClientSnapshot,
} from "./client-protocol.ts"
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
  waitForFrame?(): Promise<void>
  shell?: Omit<CreateExternalStorybookShellOptions, "title" | "browserDocument">
}>

export type StartExternalStorybookPackageInput = Readonly<{
  packageId: string
  candidateRevision: string | null
  revisionUrl: string | null
  loadRuntime: ExternalStorybookRuntimeLoader
  storyLoaders: ReadonlyMap<string, ExternalStorybookStoryLoader>
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

  const fetcher = environment.fetcher ?? globalThis.fetch
  const snapshot = await fetchExternalStorybookClientSnapshot(fetcher)
  const summary = exactPackageSummary(snapshot, packageId)
  if (candidateRevision !== null &&
    summary.activeRevision !== candidateRevision && summary.lastGoodRevision !== candidateRevision) {
    throw new Error(`External Storybook revision is not active or last-good: ${candidateRevision}`)
  }
  if (candidateRevision === null && (input.loadRuntime !== null || storyLoaders.size > 0)) {
    throw new Error(`Unavailable Storybook package cannot receive executable loaders: ${packageId}`)
  }
  const graph = snapshot
  for (const [route, loader] of storyLoaders) {
    if (typeof loader !== "function") throw new TypeError(`External Storybook story loader is not callable: ${route}`)
    const model = deriveExternalStorybookPackageTab(graph, packageId, route)
    if (model.selectedNode.kind !== "variant") {
      throw new Error(`External Storybook story loader route is not a variant: ${route}`)
    }
  }
  const initialRoute = packageRouteFromPathname(location.pathname, packageId)
  const initialModel = deriveExternalStorybookPackageTab(graph, packageId, initialRoute)
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
  let disposed = false

  const context: StorybookRuntimeContext = Object.freeze({
    document: shell.document,
    browserDocument,
    canvas: shell.canvas,
    signal: lifetime.signal,
    mount(node: SemanticNode) {
      if (contextRevision !== navigationRevision || routeAbort.signal.aborted) {
        throw new Error("External Storybook runtime attempted a stale mount")
      }
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
  })

  const ensureSession = async (): Promise<StorybookRuntimeSession> => {
    if (session !== null) return session
    if (sessionPromise !== null) return sessionPromise
    if (input.loadRuntime === null) throw new Error(`Executable Storybook variant has no runtime: ${packageId}`)
    const pending = Promise.resolve()
      .then(() => input.loadRuntime!())
      .then(validateStorybookRuntimeAdapter)
      .then((adapter) => adapter.create(context))
      .then(validateStorybookRuntimeSession)
      .then(async (created) => {
        await shell.setOwnerStyleSheets(created.styleSheets ?? Object.freeze([]))
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
    shell.showMessage(`${model.selectedNode.label} · Загрузка`, model.selectedNode.label, "Загрузка owner story…")
    const [runtimeSession, story] = await Promise.all([ensureSession(), loader()])
    if (disposed || revision !== navigationRevision || signal.aborted) return
    const storyInput = Object.freeze({route, story, signal})
    if (mountedRoute === route && runtimeSession.update !== undefined) {
      await runtimeSession.update(storyInput)
      if (disposed || revision !== navigationRevision || signal.aborted) return
    } else {
      if (mountedRoute !== null) await runtimeSession.unmount()
      if (disposed || revision !== navigationRevision || signal.aborted) return
      await runtimeSession.mount(storyInput)
      if (disposed || revision !== navigationRevision || signal.aborted) {
        await runtimeSession.unmount()
        return
      }
      mountedRoute = route
    }
  }

  const applyRoute = async (route: string): Promise<void> => {
    assertActive(disposed)
    const model = deriveExternalStorybookPackageTab(graph, packageId, route)
    const revision = ++navigationRevision
    routeAbort.abort()
    routeAbort = new AbortController()
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
        await showVariant(model, revision, routeAbort.signal)
      } else {
        await showOverview(model, revision)
      }
      if (disposed || revision !== navigationRevision) return
      shell.updateStatus(`${packageId} · ${route.length === 0 ? "overview" : route}`)
      shell.requestRender()
      await (environment.waitForFrame ?? waitForStorybookFrameBoundary)()
      if (disposed || revision !== navigationRevision) return
      browserDocument.documentElement.dataset.externalStorybook = "ready"
      browserDocument.documentElement.dataset.externalStorybookPackage = "ready"
    } catch (error) {
      if (disposed || revision !== navigationRevision) return
      isolatePackageError(browserDocument, shell, model, error)
    }
  }

  const navigate = async (route: string): Promise<void> => {
    assertActive(disposed)
    const model = deriveExternalStorybookPackageTab(graph, packageId, route)
    if (location.pathname !== model.selectedNode.urlPath) {
      history.pushState(null, "", model.selectedNode.urlPath)
    }
    await applyRoute(route)
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
      void applyRoute(route)
    } catch (error) {
      isolatePackageError(browserDocument, shell, currentModel, error)
    }
  }
  shell.workbench.element.addEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.navigate, onNavigate)
  shell.workbench.element.addEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.scenario, onScenario)
  globalThis.addEventListener?.("popstate", onPopState)

  const socket = createPackageSocket(environment, location.href)
  const onSocketOpen = (): void => {
    socket.send(JSON.stringify({type: "subscribe", topic: `package:${packageId}`}))
  }
  const onSocketMessage = (event: MessageEvent): void => {
    const update = parsePackageEvent(event.data)
    if (update === null || update.packageId !== packageId) return
    if (update.type === "package.updated") {
      if (update.revision !== candidateRevision) location.reload()
      return
    }
    if (update.type === "package.failed") {
      for (const diagnostic of update.diagnostics) shell.reportDiagnostic(diagnostic)
      shell.updateStatus(`${packageId} · last-good · build failed`)
      return
    }
    shell.reportDiagnostic(`Package detached: ${packageId}`)
    shell.updateStatus(`${packageId} · detached`)
  }
  socket.addEventListener("open", onSocketOpen)
  socket.addEventListener("message", onSocketMessage)

  const canonicalInitial = currentModel.selectedNode.urlPath
  if (location.pathname !== canonicalInitial) history.replaceState(null, "", canonicalInitial)
  await applyRoute(currentRoute)

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    navigationRevision += 1
    lifetime.abort()
    routeAbort.abort()
    socket.removeEventListener("open", onSocketOpen)
    socket.removeEventListener("message", onSocketMessage)
    socket.close()
    globalThis.removeEventListener?.("popstate", onPopState)
    shell.workbench.element.removeEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.navigate, onNavigate)
    shell.workbench.element.removeEventListener(STORYBOOK_DOM_WORKBENCH_EVENTS.scenario, onScenario)
    if (session !== null) {
      if (mountedRoute !== null) await session.unmount()
      await session.dispose()
    }
    shell.dispose()
  }
  globalThis.addEventListener?.("pagehide", () => { void dispose() }, {once: true})
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
): ExternalStorybookSocket {
  const url = new URL("/api/events", href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
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
  if (record.type === "package.failed" && typeof record.packageId === "string" && Array.isArray(record.diagnostics)) {
    return {type: record.type, packageId: record.packageId, diagnostics: record.diagnostics}
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("External Storybook package tab is disposed")
}

if (typeof document !== "undefined" && document.documentElement.dataset.externalStorybookEntry === "package") {
  // Generated immutable entries call startExternalStorybookPackage with their
  // literal loaders. A bare source module deliberately has nothing to start.
}
