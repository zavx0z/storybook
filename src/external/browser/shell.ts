/** One semantic Workbench Experience projected into a camera-locked overlay. */

import {loadDocumentDefaultFont} from "@engine/core/default-font"
import {
  createDocument,
  type Document as SemanticDocument,
  type HTMLElement as SemanticElement,
  type Node as SemanticNode,
} from "@zavx0z/dom"
import {
  createBrowserLinkedAuthorStyleSheetHost,
  createDocumentSpaceRuntime,
  type BrowserLinkedAuthorStyleSheetHost,
  type BrowserLinkedAuthorStyleSheetSource,
  type DocumentOverlayRuntime,
  type DocumentSpaceRuntime,
  type DocumentSpaceViewPointSnapshot,
} from "@zavx0z/renderer-browser"
import {
  createStorybookDomWorkbench,
  type StorybookDomWorkbench,
  type StorybookDomWorkbenchPresentationUpdate,
} from "../../dom/workbench.ts"
import {
  EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
  type ExternalStorybookClientNode,
  type ExternalStorybookClientSnapshot,
} from "./client-protocol.ts"
import {
  renderStorybookMarkdown,
} from "../markdown.ts"
import {
  createStorybookMessagePresentation,
  type StorybookOverviewAction,
} from "./landing-view.ts"
import type {StorybookComponentPresentation} from "./component-presentation.ts"
import type {
  StorybookPreviewBounds,
  StorybookWorldPreview,
  StorybookWorldPreviewCamera,
  StorybookWorldPreviewRegistration,
} from "../runtime-protocol.ts"

export const EXTERNAL_STORYBOOK_CANVAS_ID = "external-storybook-canvas" as const
export const EXTERNAL_STORYBOOK_WORKBENCH_OVERLAY_ID = "external-storybook-workbench" as const

export type ExternalStorybookShellSpaceRuntimeFactory =
  typeof createDocumentSpaceRuntime

export type ExternalStorybookLinkedAuthorStyleSheetHostFactory =
  typeof createBrowserLinkedAuthorStyleSheetHost

export type CreateExternalStorybookShellOptions = Readonly<{
  title: string
  browserDocument?: globalThis.Document
  canvas?: HTMLCanvasElement
  document?: SemanticDocument
  statusOwner?: string
  loadFont?: typeof loadDocumentDefaultFont
  createSpaceRuntime?: ExternalStorybookShellSpaceRuntimeFactory
  authorStyleSheetSources?: readonly BrowserLinkedAuthorStyleSheetSource[]
  authorStyleSheetReadyTimeoutMs?: number
  createLinkedAuthorStyleSheetHost?: ExternalStorybookLinkedAuthorStyleSheetHostFactory
}>

export type ExternalStorybookShell = Readonly<{
  document: SemanticDocument
  browserDocument: globalThis.Document
  canvas: HTMLCanvasElement
  workbench: StorybookDomWorkbench
  readonly runtime: DocumentSpaceRuntime
  readonly workbenchOverlay: DocumentOverlayRuntime
  readonly presentedFrameSequence: number
  present(value: StorybookDomWorkbenchPresentationUpdate): void
  mountPreview(label: string, node: SemanticNode): void
  showMessage(label: string, title: string, detail: string, action?: StorybookOverviewAction): SemanticElement
  showMarkdown(label: string, source: string, baseUrl?: string, action?: StorybookOverviewAction): SemanticElement
  reportDiagnostic(value: unknown): void
  clearDiagnostics(): void
  updateStatus(detail: string): void
  requestRender(): void
  presentFrame(): number
  waitForPresentedFrame(afterSequence: number, signal?: AbortSignal, timeoutMs?: number): Promise<number>
  captureLastPresentedFramePng(): Promise<Blob | null>
  subscribePreviewBounds(listener: (bounds: StorybookPreviewBounds | null) => void): () => void
  mountWorldPreview(label: string, registration: StorybookWorldPreviewRegistration): StorybookWorldPreview
  applyWorldPreviewGesture(
    node: SemanticNode,
    gesture: Readonly<{kind: "orbit" | "pan"; deltaX: number; deltaY: number}>,
  ): boolean
  dispose(): void
}>

type BoundStorybookWorldPreview = StorybookWorldPreview & Readonly<{
  suspend(): void
  resume(): void
  applyGesture(
    node: SemanticNode,
    gesture: Readonly<{kind: "orbit" | "pan"; deltaX: number; deltaY: number}>,
  ): boolean
}>

const worldViewPointSnapshot = (
  camera: StorybookWorldPreviewCamera,
): DocumentSpaceViewPointSnapshot => Object.freeze({
  position: Object.freeze({...camera.position}),
  target: Object.freeze({...camera.target}),
  up: Object.freeze({
    x: camera.up?.x ?? 0,
    y: camera.up?.y ?? 0,
    z: camera.up?.z ?? 1,
  }),
  fov: camera.fov ?? Math.PI / 4,
  near: camera.near ?? 1,
  far: camera.far ?? 2_000,
})

/** Creates one page Experience with one Document, Canvas/Renderer/Space and Workbench overlay. */
export async function createExternalStorybookShell(
  options: CreateExternalStorybookShellOptions,
): Promise<ExternalStorybookShell> {
  const browserDocument = options.browserDocument ?? globalThis.document
  if (browserDocument === undefined) throw new Error("External Storybook browser Document is unavailable")
  const canvas = options.canvas ?? ensureCanvas(browserDocument)
  const document = options.document ?? createDocument()
  const workbench = createStorybookDomWorkbench({
    document,
    parent: document,
    initial: {
      title: options.title,
      "catalog.label": "Каталог",
      "catalog.items": Object.freeze([]),
      "catalog.active": null,
      "secondary.label": "Пакеты",
      "secondary.items": Object.freeze([]),
      "secondary.active": null,
      "preview.label": "Обзор",
      presentation: Object.freeze({node: null, projection: "display"}),
      "scenarios.label": "Варианты",
      "scenarios.items": Object.freeze([]),
      "scenarios.active": null,
      status: {
        lead: "Создано для ",
        owner: options.statusOwner ?? "MetaFor",
        detail: " · External Storybook",
      },
    },
  })
  const createRuntime = options.createSpaceRuntime ?? createDocumentSpaceRuntime
  markShellPhase(browserDocument, "font")
  const font = await (options.loadFont ?? loadDocumentDefaultFont)()
  markShellPhase(browserDocument, "renderer")
  const boundsListeners = new Set<(bounds: StorybookPreviewBounds | null) => void>()
  const frameWaiters = new Set<Readonly<{
    afterSequence: number
    resolve(sequence: number): void
  }>>()
  let runtime!: DocumentSpaceRuntime
  let workbenchOverlay!: DocumentOverlayRuntime
  let unsubscribeFrame = (): void => {}
  let unsubscribePresented = (): void => {}
  let latestBounds: StorybookPreviewBounds | null = null
  let presentedFrameSequence = 0
  let activeWorldPreview: BoundStorybookWorldPreview | null = null
  let activeShellPresentation: StorybookComponentPresentation | null = null
  let authorStyleSheetHost: BrowserLinkedAuthorStyleSheetHost | null = null
  let shellDiagnostics: unknown[] = []
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

  const publishBounds = (bounds: StorybookPreviewBounds | null): void => {
    if (sameBounds(latestBounds, bounds)) return
    latestBounds = bounds
    for (const listener of [...boundsListeners]) listener(bounds)
  }
  const startExperienceHost = async (): Promise<void> => {
    if (disposed) throw new Error("External Storybook shell is disposed")
    activeWorldPreview?.suspend()
    unsubscribeFrame()
    unsubscribeFrame = () => {}
    unsubscribePresented()
    unsubscribePresented = () => {}
    runtime = await createRuntime({
      canvas,
      document,
      styleSheets: Object.freeze([]),
      font,
      cameraGestures: false,
    })
    try {
      unsubscribePresented = runtime.subscribePresented(() => {
        presentedFrameSequence += 1
        for (const waiter of [...frameWaiters]) {
          if (presentedFrameSequence <= waiter.afterSequence) continue
          frameWaiters.delete(waiter)
          waiter.resolve(presentedFrameSequence)
        }
      })
      workbenchOverlay = runtime.addOverlay({
        id: EXTERNAL_STORYBOOK_WORKBENCH_OVERLAY_ID,
        root: workbench.element,
        tooltipDelayMs: 500,
      })
      unsubscribeFrame = workbenchOverlay.subscribe((frame) => {
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
      runtime.render()
      activeWorldPreview?.resume()
    } catch (error) {
      unsubscribeFrame()
      unsubscribeFrame = () => {}
      unsubscribePresented()
      unsubscribePresented = () => {}
      runtime.dispose()
      throw error
    }
  }
  const authorStyleSheetSources = options.authorStyleSheetSources ?? Object.freeze([])
  if (!Array.isArray(authorStyleSheetSources)) {
    throw new TypeError("External Storybook author stylesheet sources must be a list")
  }
  if (authorStyleSheetSources.length > 0) {
    markShellPhase(browserDocument, "author-styles")
    authorStyleSheetHost = (options.createLinkedAuthorStyleSheetHost ??
      createBrowserLinkedAuthorStyleSheetHost)({
      canvas,
      document,
      sources: authorStyleSheetSources,
      onError(error, source) {
        appendShellDiagnostic(Object.freeze({
          phase: "author-styles",
          message: error.message,
          source: source?.id ?? null,
        }))
        if (runtime !== undefined && !disposed) runtime.requestRender()
      },
    })
    try {
      await waitForAuthorStyleSheetHost(
        authorStyleSheetHost,
        options.authorStyleSheetReadyTimeoutMs ?? 8_000,
      )
    } catch (error) {
      authorStyleSheetHost.dispose()
      workbench.dispose()
      throw error
    }
  }
  try {
    await startExperienceHost()
  } catch (error) {
    authorStyleSheetHost?.dispose()
    workbench.dispose()
    throw error
  }
  markShellPhase(browserDocument, "ready")

  const mountPreviewNode = (
    label: string,
    node: SemanticNode,
    projection: "display" | "hud" | "world" = "display",
  ): void => {
    assertActive(disposed)
    workbench.present({
      label,
      presentation: Object.freeze({node, projection}),
      inspectorSubject: workbench.controller.read("inspector.subject"),
      inspectorValues: workbench.controller.read("inspector.values"),
    })
    runtime.requestRender()
  }
  const mountPreview = (label: string, node: SemanticNode): void => {
    activeWorldPreview?.dispose()
    activeShellPresentation?.dispose()
    activeShellPresentation = null
    mountPreviewNode(label, node)
  }
  const mountWorldPreview = (
    label: string,
    registration: StorybookWorldPreviewRegistration,
  ): StorybookWorldPreview => {
    assertActive(disposed)
    if (registration === null || typeof registration !== "object") {
      throw new TypeError("Storybook world preview registration is required")
    }
    if (Object.hasOwn(registration, "space")) {
      throw new TypeError("Storybook world preview registration.space is forbidden; use the one Experience Space")
    }
    activeWorldPreview?.dispose()
    activeShellPresentation?.dispose()
    activeShellPresentation = null
    mountPreviewNode(label, registration.node, "world")
    const initialViewPoint = worldViewPointSnapshot(registration.camera)
    const restoredViewPoint = runtime.snapshotViewPoint()
    runtime.restoreViewPoint(initialViewPoint)
    const startedFrame = presentedFrameSequence
    let previewDisposed = false
    let unsubscribeBounds = (): void => {}
    let controller!: BoundStorybookWorldPreview

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
        return Math.max(0, presentedFrameSequence - startedFrame)
      },
      get disposed() {
        return previewDisposed
      },
      requestRender() {
        if (previewDisposed) throw new Error("Storybook world preview is disposed")
        runtime.requestRender()
      },
      resetViewPoint() {
        if (previewDisposed) throw new Error("Storybook world preview is disposed")
        runtime.restoreViewPoint(initialViewPoint)
        runtime.requestRender()
      },
      suspend() {},
      resume() {
        if (previewDisposed) return
        runtime.restoreViewPoint(initialViewPoint)
        applyBounds(latestBounds)
      },
      applyGesture(node, gesture) {
        if (
          previewDisposed ||
          registration.cameraGestures === false ||
          !(registration.node.contains(node) || node.contains(registration.node))
        ) return false
        if (gesture.kind === "orbit") {
          runtime.viewPoint.orbit(gesture.deltaX, gesture.deltaY)
        } else {
          runtime.viewPoint.pan(gesture.deltaX, gesture.deltaY)
        }
        runtime.requestRender()
        return true
      },
      dispose() {
        if (previewDisposed) return
        previewDisposed = true
        unsubscribeBounds()
        unsubscribeBounds = () => {}
        if (!runtime.disposed) {
          runtime.restoreViewPoint(restoredViewPoint)
          runtime.requestRender()
        }
        if (activeWorldPreview === controller) activeWorldPreview = null
      },
    })
    activeWorldPreview = controller
    boundsListeners.add(applyBounds)
    unsubscribeBounds = () => boundsListeners.delete(applyBounds)
    applyBounds(latestBounds)
    return controller
  }
  const mountShellPresentation = (
    label: string,
    presentation: StorybookComponentPresentation,
  ): SemanticElement => {
    activeWorldPreview?.dispose()
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
  ): SemanticElement => mountShellPresentation(label, createStorybookMessagePresentation(document, {
    title,
    detail,
    ...(action === undefined ? {} : {action}),
  }))
  const showMarkdown = (
    label: string,
    source: string,
    baseUrl?: string,
    action?: StorybookOverviewAction,
  ): SemanticElement => mountShellPresentation(label, renderStorybookMarkdown({
    document,
    source,
    ...(baseUrl === undefined ? {} : {baseUrl}),
    ...(action === undefined ? {} : {action}),
  }))

  const shell: ExternalStorybookShell = Object.freeze({
    document,
    browserDocument,
    canvas,
    workbench,
    get runtime() {
      return runtime
    },
    get workbenchOverlay() {
      return workbenchOverlay
    },
    get presentedFrameSequence() {
      return presentedFrameSequence
    },
    present(value) {
      assertActive(disposed)
      activeShellPresentation?.dispose()
      activeShellPresentation = null
      workbench.present(value)
      runtime.requestRender()
    },
    mountPreview,
    mountWorldPreview,
    showMessage,
    showMarkdown,
    reportDiagnostic(value) {
      assertActive(disposed)
      appendShellDiagnostic(value)
      runtime.requestRender()
    },
    clearDiagnostics() {
      assertActive(disposed)
      shellDiagnostics = []
      publishShellDiagnostics()
      runtime.requestRender()
    },
    updateStatus(detail) {
      assertActive(disposed)
      workbench.update("status", {
        lead: "Создано для ",
        owner: options.statusOwner ?? "MetaFor",
        detail: ` · ${detail}`,
      })
      runtime.requestRender()
    },
    requestRender() {
      assertActive(disposed)
      runtime.requestRender()
    },
    presentFrame() {
      assertActive(disposed)
      const before = presentedFrameSequence
      runtime.render()
      if (presentedFrameSequence <= before) {
        throw new Error("Storybook renderer did not publish the synchronous frame")
      }
      return presentedFrameSequence
    },
    waitForPresentedFrame(afterSequence, signal, timeoutMs = 8_000) {
      assertActive(disposed)
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new TypeError("Presented frame sequence must be a non-negative integer")
      }
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
        throw new RangeError("Presented frame timeout must be between 1 and 30000 ms")
      }
      if (presentedFrameSequence > afterSequence) return Promise.resolve(presentedFrameSequence)
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
        else runtime.requestRender()
      })
    },
    captureLastPresentedFramePng() {
      assertActive(disposed)
      return runtime.captureLastPresentedFramePng()
    },
    subscribePreviewBounds(listener) {
      assertActive(disposed)
      if (typeof listener !== "function") throw new TypeError("Preview bounds listener must be a function")
      boundsListeners.add(listener)
      listener(latestBounds)
      return () => boundsListeners.delete(listener)
    },
    applyWorldPreviewGesture(node, gesture) {
      assertActive(disposed)
      return activeWorldPreview?.applyGesture(node, gesture) ?? false
    },
    dispose() {
      if (disposed) return
      disposed = true
      activeWorldPreview?.dispose()
      activeShellPresentation?.dispose()
      activeShellPresentation = null
      unsubscribeFrame()
      unsubscribePresented()
      boundsListeners.clear()
      for (const waiter of frameWaiters) waiter.resolve(presentedFrameSequence)
      frameWaiters.clear()
      runtime.dispose()
      authorStyleSheetHost?.dispose()
      workbench.dispose()
    },
  })
  return shell
}

function canvasPixelRatio(
  canvas: HTMLCanvasElement,
  bounds: StorybookPreviewBounds,
): number {
  const width = Number(canvas.width)
  const ratio = width > 0 && bounds.viewportWidth > 0
    ? width / bounds.viewportWidth
    : 1
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

async function waitForAuthorStyleSheetHost(
  host: BrowserLinkedAuthorStyleSheetHost,
  timeoutMs: number,
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new RangeError("Storybook author stylesheet ready timeout must be between 1 and 30000 ms")
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      host.ready,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(
          `Required Storybook author stylesheets did not become ready within ${timeoutMs} ms`,
        )), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/** Fetches and validates the serializable browser snapshot. */
export async function fetchExternalStorybookClientSnapshot(
  fetcher: typeof fetch = globalThis.fetch,
  url = "/api/client",
): Promise<ExternalStorybookClientSnapshot> {
  const response = await fetcher(url, {headers: {accept: "application/json"}})
  if (!response.ok) throw new Error(`External Storybook client request failed: ${response.status}`)
  return validateClientSnapshot(await response.json())
}

export async function readExternalStorybookNodeReadme(
  node: ExternalStorybookClientNode,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<string | null> {
  if (!node.hasReadme) return null
  const response = await fetcher(node.resourceUrl, {headers: {accept: "text/markdown, text/plain"}})
  if (!response.ok) throw new Error(`External Storybook README request failed: ${response.status}`)
  return response.text()
}

export function externalStorybookClientNode(
  snapshot: ExternalStorybookClientSnapshot,
  nodeId: string,
): ExternalStorybookClientNode {
  const matches = snapshot.nodes.filter(({id}) => id === nodeId)
  if (matches.length === 0) throw new Error(`Unknown external Storybook client node: ${nodeId}`)
  if (matches.length > 1) throw new Error(`Ambiguous external Storybook client node: ${nodeId}`)
  return matches[0]!
}

function validateClientSnapshot(value: unknown): ExternalStorybookClientSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("External Storybook client snapshot must be an object")
  }
  const snapshot = value as Partial<ExternalStorybookClientSnapshot>
  if (snapshot.protocol !== EXTERNAL_STORYBOOK_CLIENT_PROTOCOL) {
    throw new Error(`Unsupported external Storybook client protocol: ${String(snapshot.protocol)}`)
  }
  if (typeof snapshot.graphDigest !== "string" || snapshot.graphDigest.length === 0 ||
    !Array.isArray(snapshot.rootIds) || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.packages)) {
    throw new Error("External Storybook client snapshot is incomplete")
  }
  const ids = new Set<string>()
  for (const node of snapshot.nodes) {
    if (node === null || typeof node !== "object" || typeof node.id !== "string" || ids.has(node.id) ||
      !Array.isArray(node.childIds) || !Array.isArray(node.searchTerms) ||
      typeof node.resourceUrl !== "string" || !Array.isArray(node.resourceKinds)) {
      throw new Error(`Invalid external Storybook client node: ${String(node?.id)}`)
    }
    if (node.kind === "subject" || node.kind === "variant") {
      const presentation = node.presentation
      if (presentation === null || presentation === undefined ||
        presentation.protocol !== "story-presentation/1" ||
        (presentation.projection !== "display" && presentation.projection !== "world" &&
          presentation.projection !== "hud") ||
        !Array.isArray(presentation.widgets) || presentation.widgets.length < 2 ||
        new Set(presentation.widgets).size !== presentation.widgets.length ||
        !presentation.widgets.includes("source") || !presentation.widgets.includes("diagnostics")) {
        throw new Error(`Invalid external Storybook client presentation: ${node.id}`)
      }
    } else if (node.presentation !== null) {
      throw new Error(`Unexpected external Storybook client presentation: ${node.id}`)
    }
    ids.add(node.id)
  }
  for (const rootId of snapshot.rootIds) {
    if (typeof rootId !== "string" || !ids.has(rootId)) {
      throw new Error(`Unknown external Storybook client root: ${String(rootId)}`)
    }
  }
  return snapshot as ExternalStorybookClientSnapshot
}

function ensureCanvas(document: globalThis.Document): HTMLCanvasElement {
  const existing = document.getElementById(EXTERNAL_STORYBOOK_CANVAS_ID)
  if (existing !== null) {
    if (!(existing instanceof HTMLCanvasElement)) {
      throw new Error(`${EXTERNAL_STORYBOOK_CANVAS_ID} is not a canvas`)
    }
    return existing
  }
  const canvas = document.createElement("canvas")
  canvas.id = EXTERNAL_STORYBOOK_CANVAS_ID
  canvas.tabIndex = 0
  if (document.body === null) throw new Error("External Storybook document.body is unavailable")
  document.body.appendChild(canvas)
  return canvas
}

function sameBounds(
  left: StorybookPreviewBounds | null,
  right: StorybookPreviewBounds | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("External Storybook shell is disposed")
}

function markShellPhase(document: globalThis.Document, phase: string): void {
  const root = document.documentElement
  if (root !== undefined && root !== null && root.dataset !== undefined) {
    root.dataset.externalStorybookShellPhase = phase
  }
}
