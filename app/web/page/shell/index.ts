/**
Подключает Workbench и служебные окна к одному Browser Root страницы Storybook.
Тот же Document и Space принимают обзоры, контракты, зависимости и пространственное
содержимое; Shell связывает выбор представления с кадрами и диагностикой.
Настройки обзора, окон и навигации сохраняются между сессиями и заменами Web.
Обычное завершение освобождает подключение; releaseRoot передаёт существующий Root
следующей реализации с сохранением общей среды страницы.

@packageDocumentation
*/
import WebProtocol from "@app-web/protocol"
import {createViewPointPersistence} from "./src/viewpoint-persistence.ts"
import createViewPointControls from "@web/viewpoint-controls"
import {DisplayElement} from "@zavx0z/dom/display"
import {createMcpAddressSource} from "./src/mcp-address.ts"
import {createWebRebuildAction} from "./src/web-rebuild.ts"
import {createMinimapPersistence} from "./src/minimap-persistence.ts"
import {createMcpWindowPersistence} from "./src/mcp-window-persistence.ts"
import {createNavigationExpansion} from "./src/navigation-persistence.ts"
import {createRoot as createBrowserRoot, type Presentation as Root, type RootProjection} from "@zavx0z/browser/integration"
import {loadDocumentDefaultFont} from "@zavx0z/engine/default-font"
import {StorybookApp} from "./src/application.tsx"
import type {StorybookAppProps} from "./src/application-props"
import {component} from "@zavx0z/component"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {HTMLElement as SemanticHTMLElement, type Node as SemanticNode} from "@zavx0z/dom"
import {HUDElement} from "@zavx0z/dom/hud"
import type {WebWorkbenchModel} from "@web/workbench-model"
type Workbench = ReturnType<WebWorkbenchModel.Output["bind"]>

import {renderStorybookMarkdown, type StorybookMarkdownPresentation} from "./src/markdown.ts"
import {createStorybookMessagePresentation} from "./src/message-presentation.ts"
import type {StorybookOverviewAction} from "./contract/overview-action.ts"
import type {StorybookPreviewBounds, StorybookSpacePreview, StorybookSpacePreviewRegistration} from "./contract/preview.ts"
import type {PageShell} from "./contract"
type CreateExternalStorybookShellOptions = PageShell.Input
type ExternalStorybookShell = PageShell.Output
import type {ExternalStorybookNativeKey} from "./contract/types"
import type {StorybookComponentPresentation, BoundStorybookSpacePreview} from "./src/types"
import {EXTERNAL_STORYBOOK_CANVAS_ID, EXTERNAL_STORYBOOK_DISPLAY_ID, EXTERNAL_STORYBOOK_WORKBENCH_ID, spaceViewPointSnapshot, canvasPixelRatio, readViewPointSnapshot, writeViewPointSnapshot, ensureCanvas, sameBounds, assertActive, markShellPhase} from './src/implementation'
export type {PageShell} from './contract'

/** Подключает авторский Workbench App и связывает его проекции с навигацией Storybook. */
async function createExternalStorybookShell(
  options: CreateExternalStorybookShellOptions,
): Promise<ExternalStorybookShell> {
  const browserDocument = options.browserDocument ?? globalThis.document
  if (browserDocument === undefined) throw new Error("External Storybook browser Document is unavailable")
  const canvas = options.canvas ?? ensureCanvas(browserDocument)
  const authorStyleSheetSources = options.authorStyleSheetSources ?? Object.freeze([])
  if (!Array.isArray(authorStyleSheetSources)) {
    throw new TypeError("External Storybook author stylesheet sources must be a list")
  }
  markShellPhase(browserDocument, "font")
  const font = await (options.loadFont ?? loadDocumentDefaultFont)()
  if (authorStyleSheetSources.length > 0) markShellPhase(browserDocument, "author-styles")
  markShellPhase(browserDocument, "renderer")
  const pendingAuthorDiagnostics: unknown[] = []
  let publishAuthorDiagnostic = (value: unknown): void => {
    pendingAuthorDiagnostics.push(value)
  }
  let workbench!: Workbench
  const start = options.createRoot ?? createBrowserRoot
  const diagnostics = options.retainedRoot?.diagnostics ?? {publish: publishAuthorDiagnostic}
  diagnostics.publish = value => publishAuthorDiagnostic(value)
  const application = options.retainedRoot?.application ?? start(canvas, {
    font,
    ...(options.loadFont === undefined ? {fontSources: WebProtocol.fontFaces} : {}),
    stylesheets: authorStyleSheetSources,
    onUncaughtError(error) {
      diagnostics.publish(Object.freeze({
        phase: "author-styles",
        message: error.message,
        source: null,
      }))
    },
  })
  const viewPointPersistence = createViewPointPersistence(() => browserDocument.defaultView!.localStorage)
  if (options.userState !== undefined) {
    delete viewPointPersistence.state.camera
    delete viewPointPersistence.state.frozen
    Object.assign(viewPointPersistence.state, structuredClone(options.userState.viewPoint))
  }
  const viewPointControls = createViewPointControls(viewPointPersistence)
  const minimap = createMinimapPersistence(() => browserDocument.defaultView!.localStorage)
  const mcpWindow = createMcpWindowPersistence(() => browserDocument.defaultView!.localStorage)
  const navigationPersistence = createNavigationExpansion(() => browserDocument.defaultView!.localStorage)
  let minimapState = options.userState?.minimap ?? minimap.initialState
  let mcpWindowState = options.userState?.mcpWindow ?? mcpWindow.initialState
  let collapsedNavigation = options.userState?.collapsedNavigation ?? navigationPersistence.initialCollapsedIds
  const navigationExpansion = {
    initialCollapsedIds: collapsedNavigation,
    save(ids: readonly string[]) {
      collapsedNavigation = [...ids]
      navigationPersistence.save(ids)
    },
  }
  // Новый ключ монтирует актуальную App даже при неизменившемся compiler chunk её шаблона.
  application.render(component(StorybookApp as unknown as CompiledTemplate<StorybookAppProps>, {
    title: options.title,
    userState: options.userState?.workbench,
    viewPointControls,
    statusOwner: options.statusOwner ?? options.title,
    displayId: EXTERNAL_STORYBOOK_DISPLAY_ID,
    hudId: EXTERNAL_STORYBOOK_WORKBENCH_ID,
    mcpAddressSource: createMcpAddressSource(() => `${browserDocument.location.pathname}${browserDocument.location.search}`),
    onRebuildWeb: createWebRebuildAction(),
    minimapState,
    saveMinimapState(value) {
      minimapState = value
      minimap.save(value)
    },
    mcpWindowState,
    saveMcpWindowState(value) {
      mcpWindowState = value
      mcpWindow.save(value)
    },
    navigationExpansion,
    async loadMcpRequests() {
      const session = await fetch("/api/browser/registry-session", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: "{}",
      })
      if (!session.ok) throw new Error("Не удалось открыть сессию журнала MCP")
      const {readerToken: token} = await session.json()
      if (typeof token !== "string") throw new Error("Нет сессии Storybook для чтения журнала")
      const response = await fetch("/api/browser/mcp-requests", {headers: {"x-storybook-session": token}})
      if (!response.ok) throw new Error("Не удалось получить журнал MCP")
      return (await response.json()).entries
    },
    onReady(value) { workbench = value },
  }, globalThis.crypto.randomUUID()))
  let root: Root
  try { root = await application.whenReady() } catch (error) {
    viewPointControls.dispose()
    if (options.retainedRoot === undefined) application.unmount()
    throw error
  }
  const document = root.document
  const space = root.space
  const viewPoint = root.viewPoint
  const display = document.getElementById(EXTERNAL_STORYBOOK_DISPLAY_ID)
  const hud = document.getElementById(EXTERNAL_STORYBOOK_WORKBENCH_ID)
  if (!(display instanceof DisplayElement) || !(hud instanceof HUDElement) || workbench === undefined) {
    viewPointControls.dispose()
    if (options.retainedRoot === undefined) root.unmount()
    throw new Error("Storybook App did not mount its Display, HUD and Workbench")
  }
  const displayProjection = root.getProjection(display)
  const hudProjection = root.getProjection(hud)
  const spaceProjection = root.getProjection(space)
  const boundsListeners = new Set<(bounds: StorybookPreviewBounds | null) => void>()
  const frameWaiters = new Set<Readonly<{
    afterSequence: number
    resolve(sequence: number): void
  }>>()
  let unsubscribeFrame = (): void => {}
  let unsubscribeViewport = (): void => {}
  let unsubscribePresented = (): void => {}
  let latestBounds: StorybookPreviewBounds | null = null
  let fittedViewport = ""
  let latestViewport: Readonly<{width: number; height: number}> | null = null
  let activeSpacePreview: BoundStorybookSpacePreview | null = null
  let mountingSpacePreview = false
  let activeShellPresentation: StorybookComponentPresentation | null = null
  let shellDiagnostics: unknown[] = [...pendingAuthorDiagnostics]
  let disposed = false

  const publishShellDiagnostics = (): void => {
    const current = workbench.controller.read("inspector.values")
    workbench.update("inspector.values", Object.freeze({
      ...current,
      diagnostics: Object.freeze([...shellDiagnostics]),
    }))
  }
  const appendShellDiagnostic = (value: unknown): void => {
    shellDiagnostics.push(value)
    publishShellDiagnostics()
  }
  publishAuthorDiagnostic = (value): void => {
    if (disposed) return
    appendShellDiagnostic(value)
    root.invalidate()
  }
  if (shellDiagnostics.length > 0) publishShellDiagnostics()

  /** HUD предоставляет viewport общего Root, независимо от CSS-размеров Display. */
  const fitWorkbench = (viewport: Readonly<{width: number; height: number}>, force = false): void => {
    if (viewport.width <= 0 || viewport.height <= 0) return
    latestViewport = viewport
    const key = `${viewport.width}:${viewport.height}`
    if (!force && key === fittedViewport) return
    fittedViewport = key
    const units = 25.4 / 96
    document.transaction(() => {
      display.width = viewport.width * units
      display.height = viewport.height * units
      display.setAttribute("style", `--workbench-resolution-width: ${Math.round(viewport.width)}px; --workbench-resolution-height: ${Math.round(viewport.height)}px;`)
      if (activeSpacePreview !== null) return
      const distance = Math.max(viewPoint.near * 1.01, units * viewport.height / (2 * Math.tan(viewPoint.fov / 2)))
      writeViewPointSnapshot(document, viewPoint, {
        position: {x: 0, y: -distance, z: 0},
        target: {x: 0, y: 0, z: 0},
        fov: viewPoint.fov,
        near: viewPoint.near,
        far: Math.max(viewPoint.far, distance + 1000),
      })
    })
    viewPointControls.restoreCamera()
  }
  viewPointControls.bind(viewPoint, () => {
    if (activeSpacePreview !== null) activeSpacePreview.resetViewPoint()
    else if (latestViewport !== null) fitWorkbench(latestViewport, true)
    root.invalidate()
  }, () => activeSpacePreview === null && !mountingSpacePreview)
  const publishBounds = (bounds: StorybookPreviewBounds | null): void => {
    if (sameBounds(latestBounds, bounds)) return
    latestBounds = bounds
    for (const listener of [...boundsListeners]) listener(bounds)
  }
  try {
    unsubscribePresented = root.subscribePresented(sequence => {
      for (const waiter of [...frameWaiters]) {
        if (sequence <= waiter.afterSequence) continue
        frameWaiters.delete(waiter)
        waiter.resolve(sequence)
      }
    })
    unsubscribeViewport = hudProjection.subscribeFrames(frame => fitWorkbench(frame.viewport))
    unsubscribeFrame = displayProjection.subscribeFrames(frame => {
      const box = frame.boxByNode.get(workbench.elements.previewHost)
      publishBounds(box === undefined
        ? null
        : Object.freeze({
          x: box.contentX,
          y: box.contentY,
          width: box.contentWidth,
          height: box.contentHeight,
          viewportWidth: frame.viewport.width,
          viewportHeight: frame.viewport.height,
        }))
    })
    root.render()
  } catch (error) {
    unsubscribeFrame()
    unsubscribeViewport()
    unsubscribePresented()
    viewPointControls.dispose()
    workbench.dispose()
    if (options.retainedRoot === undefined) root.unmount()
    throw error
  }
  markShellPhase(browserDocument, "ready")

  const mountPreviewNode = (
    label: string,
    node: SemanticNode,
    projection: "display" | "hud" | "space" = "display",
  ): void => {
    assertActive(disposed)
    workbench.present({
      label,
      presentation: Object.freeze({node, projection}),
      inspectorSubject: workbench.controller.read("inspector.subject"),
      inspectorValues: workbench.controller.read("inspector.values"),
    })
    root.invalidate()
  }
  const mountPreview = (label: string, node: SemanticNode): void => {
    activeSpacePreview?.dispose()
    activeShellPresentation?.dispose()
    activeShellPresentation = null
    mountPreviewNode(label, node)
  }
  const mountSpacePreview = (
    label: string,
    registration: StorybookSpacePreviewRegistration,
  ): StorybookSpacePreview => {
    assertActive(disposed)
    if (registration === null || typeof registration !== "object") {
      throw new TypeError("Storybook Space preview registration is required")
    }
    if (Object.hasOwn(registration, "space")) {
      throw new TypeError("Storybook Space preview registration.space is forbidden; use the one Root Space")
    }
    activeSpacePreview?.dispose()
    activeShellPresentation?.dispose()
    activeShellPresentation = null
    mountPreviewNode(label, registration.node, "space")
    const initialViewPoint = spaceViewPointSnapshot(registration.camera)
    const restoredViewPoint = readViewPointSnapshot(viewPoint)
    const restoredControls = viewPoint.controls
    mountingSpacePreview = true
    viewPoint.controls = registration.cameraGestures !== false
    writeViewPointSnapshot(document, viewPoint, initialViewPoint)
    const startedFrame = root.presentedFrame
    let previewDisposed = false
    let unsubscribeBounds = (): void => {}
    let controller!: BoundStorybookSpacePreview

    const applyBounds = (bounds: StorybookPreviewBounds | null): void => {
      if (previewDisposed || disposed || bounds === null ||
        bounds.width <= 0 || bounds.height <= 0 || registration.resize === undefined) return
      const pixelRatio = canvasPixelRatio(canvas, bounds)
      registration.resize(Object.freeze({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        backingX: bounds.x * pixelRatio,
        backingY: bounds.y * pixelRatio,
        backingWidth: bounds.width * pixelRatio,
        backingHeight: bounds.height * pixelRatio,
        pixelRatio,
      }))
    }
    controller = Object.freeze({
      get frames() {
        return Math.max(0, root.presentedFrame - startedFrame)
      },
      get disposed() {
        return previewDisposed
      },
      requestRender() {
        if (previewDisposed) throw new Error("Storybook Space preview is disposed")
        root.invalidate()
      },
      resetViewPoint() {
        if (previewDisposed) throw new Error("Storybook Space preview is disposed")
        writeViewPointSnapshot(document, viewPoint, initialViewPoint)
        root.invalidate()
      },
      suspend() {},
      resume() {
        if (previewDisposed) return
        writeViewPointSnapshot(document, viewPoint, initialViewPoint)
        applyBounds(latestBounds)
      },
      dispose() {
        if (previewDisposed) return
        previewDisposed = true
        unsubscribeBounds()
        unsubscribeBounds = () => {}
        if (!root.disposed) {
          viewPoint.controls = restoredControls
          writeViewPointSnapshot(document, viewPoint, restoredViewPoint)
          root.invalidate()
        }
        if (activeSpacePreview === controller) activeSpacePreview = null
      },
    })
    activeSpacePreview = controller
    mountingSpacePreview = false
    boundsListeners.add(applyBounds)
    unsubscribeBounds = () => boundsListeners.delete(applyBounds)
    applyBounds(latestBounds)
    return controller
  }
  const mountShellPresentation = (
    label: string,
    presentation: StorybookComponentPresentation,
  ): SemanticHTMLElement => {
    activeSpacePreview?.dispose()
    activeShellPresentation?.dispose()
    activeShellPresentation = presentation
    mountPreviewNode(label, presentation.element)
    return presentation.element
  }
  const showMessage = (
    label: string,
    title: string,
    detail: string,
    action?: StorybookOverviewAction,
  ): SemanticHTMLElement => mountShellPresentation(label, createStorybookMessagePresentation(document, {
    title,
    detail,
    ...(action === undefined ? {} : {action}),
  }))
  const showMarkdown = (
    label: string,
    source: string,
    baseUrl?: string,
    action?: StorybookOverviewAction,
  ): SemanticHTMLElement => {
    const props = {
      source,
      ...(baseUrl === undefined ? {} : {baseUrl}),
      ...(action === undefined ? {} : {action}),
    }
    if (activeShellPresentation !== null && "update" in activeShellPresentation) {
      const presentation = activeShellPresentation as StorybookMarkdownPresentation
      presentation.update(props)
      mountPreviewNode(label, presentation.element)
      return presentation.element
    }
    return mountShellPresentation(label, renderStorybookMarkdown({document, ...props}))
  }

  const projectionFor = (node: SemanticNode): RootProjection => {
    if (node === display || display.contains(node)) return displayProjection
    if (node === hud || hud.contains(node)) return hudProjection
    if (node === space || space.contains(node)) return spaceProjection
    throw new Error("Storybook semantic node is outside the Root Space")
  }
  const dispatchNativeKey = (
    target: SemanticHTMLElement,
    input: ExternalStorybookNativeKey,
  ): void => {
    assertActive(disposed)
    if (!(target instanceof SemanticHTMLElement)) {
      throw new TypeError("Storybook native key target must be an @zavx0z/dom HTMLElement")
    }
    const projection = projectionFor(target)
    if (projection.kind === "space") {
      throw new Error("Storybook native key target has no Display or HUD projection")
    }
    const init = {
      key: input.key,
      altKey: input.altKey,
      ctrlKey: input.ctrlKey,
      metaKey: input.metaKey,
      shiftKey: input.shiftKey,
    } as const
    root.dispatchKey(projection.owner, target, {type: "keydown", ...init})
    root.dispatchKey(projection.owner, target, {type: "keyup", ...init})
  }
  const dispatchNativeText = (target: SemanticHTMLElement, text: string): void => {
    assertActive(disposed)
    if (!(target instanceof SemanticHTMLElement)) {
      throw new TypeError("Storybook native text target must be an @zavx0z/dom HTMLElement")
    }
    const projection = projectionFor(target)
    if (projection.kind === "space") throw new Error("Storybook native text target has no Display or HUD projection")
    root.dispatchText(projection.owner, target, text)
  }

  const shell: ExternalStorybookShell = Object.freeze({
    document,
    browserDocument,
    canvas,
    root,
    space,
    viewPoint,
    display,
    hud,
    workbench,
    get presentedFrameSequence() {
      return root.presentedFrame
    },
    projectionFor,
    present(value) {
      assertActive(disposed)
      activeShellPresentation?.dispose()
      activeShellPresentation = null
      workbench.present(value)
      root.invalidate()
    },
    mountPreview,
    mountSpacePreview,
    showMessage,
    showMarkdown,
    async showContract(label, documents, signal, onReady, onScroll, selection) {
      const {createContractPresentation} = await import("./src/contract-view.tsx")
      signal.throwIfAborted()
      const presentation = createContractPresentation(document, documents, onReady, onScroll, selection)
      let previousViewport = ""
      // Читаем уже показанную геометрию; подписка не создаёт собственных кадров.
      const unsubscribe = root.subscribePresented(() => {
        const element = presentation.element
        const rect = element.getBoundingClientRect()
        const viewport = [element.scrollTop, element.scrollLeft, rect.x, rect.y, rect.width, rect.height].join(":")
        if (viewport === previousViewport) return
        previousViewport = viewport
        onScroll?.()
      })
      return mountShellPresentation(label, {
        ...presentation,
        dispose() {
          unsubscribe()
          presentation.dispose()
        },
      })
    },
    async showDependencies(label, cases, signal) {
      const {createDependencyPresentation} = await import("./src/dependency-view.tsx")
      signal.throwIfAborted()
      return mountShellPresentation(label, createDependencyPresentation(document, cases))
    },
    reportDiagnostic(value) {
      assertActive(disposed)
      appendShellDiagnostic(value)
      root.invalidate()
    },
    clearDiagnostics() {
      assertActive(disposed)
      shellDiagnostics = []
      publishShellDiagnostics()
      root.invalidate()
    },
    updateStatus(detail) {
      assertActive(disposed)
      const current = workbench.controller.read("status")
      workbench.update("status", {
        ...current,
        lead: "Создано для ",
        owner: options.statusOwner ?? options.title,
        detail: ` · ${detail}`,
      })
      root.invalidate()
    },
    requestRender() {
      assertActive(disposed)
      root.invalidate()
    },
    presentFrame() {
      assertActive(disposed)
      const before = root.presentedFrame
      root.render()
      if (root.presentedFrame <= before) {
        throw new Error("Storybook renderer did not publish the synchronous frame")
      }
      return root.presentedFrame
    },
    waitForPresentedFrame(afterSequence, signal, timeoutMs = 8_000) {
      assertActive(disposed)
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new TypeError("Presented frame sequence must be a non-negative integer")
      }
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
        throw new RangeError("Presented frame timeout must be between 1 and 30000 ms")
      }
      if (root.presentedFrame > afterSequence) return Promise.resolve(root.presentedFrame)
      return new Promise<number>((resolvePromise, reject) => {
        let settled = false
        const waiter = Object.freeze({
          afterSequence,
          resolve(sequence: number) {
            if (settled) return
            settled = true
            cleanup()
            resolvePromise(sequence)
          },
        })
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          cleanup()
          reject(new Error(`Storybook presented frame timed out after ${timeoutMs} ms`))
        }, timeoutMs)
        const onAbort = (): void => {
          if (settled) return
          settled = true
          cleanup()
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
        }
        const cleanup = (): void => {
          clearTimeout(timer)
          signal?.removeEventListener("abort", onAbort)
          frameWaiters.delete(waiter)
        }
        frameWaiters.add(waiter)
        signal?.addEventListener("abort", onAbort, {once: true})
        if (signal?.aborted === true) onAbort()
        else root.invalidate()
      })
    },
    captureLastPresentedFramePng() {
      assertActive(disposed)
      return root.captureLastPresentedFramePng()
    },
    subscribePreviewBounds(listener) {
      assertActive(disposed)
      if (typeof listener !== "function") throw new TypeError("Preview bounds listener must be a function")
      boundsListeners.add(listener)
      listener(latestBounds)
      return () => boundsListeners.delete(listener)
    },
    dispatchNativeKey,
    dispatchNativeText,
    captureUserState() {
      assertActive(disposed)
      return structuredClone({workbench: workbench.controller.captureUserState(), minimap: minimapState,
        mcpWindow: mcpWindowState, viewPoint: viewPointPersistence.state, collapsedNavigation})
    },
    releaseRoot() {
      if (disposed) throw new Error("Storybook shell is already disposed")
      release(false)
      return {application, diagnostics}
    },
    dispose() { release(true) },
  })
  /** Освобождает host listeners и представления, сохраняя Browser root только при явной передаче. */
  function release(unmount: boolean): void {
    if (disposed) return
    disposed = true
    viewPointControls.dispose()
    activeSpacePreview?.dispose()
    activeShellPresentation?.dispose()
    activeShellPresentation = null
    unsubscribeFrame()
    unsubscribeViewport()
    unsubscribePresented()
    boundsListeners.clear()
    for (const waiter of frameWaiters) waiter.resolve(root.presentedFrame)
    frameWaiters.clear()
    workbench.dispose()
    if (unmount) application.unmount()
  }
  return shell
}

export default Object.assign(createExternalStorybookShell, {canvasId: EXTERNAL_STORYBOOK_CANVAS_ID, displayId: EXTERNAL_STORYBOOK_DISPLAY_ID, workbenchId: EXTERNAL_STORYBOOK_WORKBENCH_ID})
