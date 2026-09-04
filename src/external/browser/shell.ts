/** One semantic Workbench Experience projected into the shared HUD. */

import {
  createExperience as createBrowserExperience,
  type Experience,
  type ExperienceLinkedAuthorStyleSheet,
  type ExperienceProjection,
} from "@zavx0z/browser"
import {loadDocumentDefaultFont} from "@zavx0z/engine/default-font"
import {
  HTMLElement as SemanticHTMLElement,
  type Document as SemanticDocument,
  type Node as SemanticNode,
} from "@zavx0z/dom"
import {
  XRDisplayElement,
  XRHUDElement,
  XRSpaceElement,
  type XRViewPointElement,
} from "@zavx0z/space"
import type {
  Workbench,
  WorkbenchPresentationUpdate,
} from "../../workbench/contract.ts"
import {createWorkbench} from "../../workbench/controller.ts"
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
} from "./message-presentation.ts"
import type {StorybookOverviewAction} from "../components/overview-action.ts"
import type {StorybookComponentPresentation} from "./component-presentation.ts"
import type {
  StorybookPreviewBounds,
  StorybookSpacePreview,
  StorybookSpacePreviewCamera,
  StorybookSpacePreviewRegistration,
} from "../runtime-protocol.ts"

export const EXTERNAL_STORYBOOK_CANVAS_ID = "external-storybook-canvas" as const
export const EXTERNAL_STORYBOOK_DISPLAY_ID = "external-storybook-display" as const
export const EXTERNAL_STORYBOOK_WORKBENCH_ID = "external-storybook-workbench" as const

export type ExternalStorybookExperienceFactory = typeof createBrowserExperience

export type ExternalStorybookNativeKey = Readonly<{
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}>

export type CreateExternalStorybookShellOptions = Readonly<{
  title: string
  browserDocument?: globalThis.Document
  canvas?: HTMLCanvasElement
  statusOwner?: string
  loadFont?: typeof loadDocumentDefaultFont
  createExperience?: ExternalStorybookExperienceFactory
  authorStyleSheetSources?: readonly ExperienceLinkedAuthorStyleSheet[]
}>

export type ExternalStorybookShell = Readonly<{
  document: SemanticDocument
  browserDocument: globalThis.Document
  canvas: HTMLCanvasElement
  experience: Experience
  space: XRSpaceElement
  viewPoint: XRViewPointElement
  display: XRDisplayElement
  hud: XRHUDElement
  workbench: Workbench
  readonly presentedFrameSequence: number
  projectionFor(node: SemanticNode): ExperienceProjection
  present(value: WorkbenchPresentationUpdate): void
  mountPreview(label: string, node: SemanticNode): void
  showMessage(label: string, title: string, detail: string, action?: StorybookOverviewAction): SemanticHTMLElement
  showMarkdown(label: string, source: string, baseUrl?: string, action?: StorybookOverviewAction): SemanticHTMLElement
  reportDiagnostic(value: unknown): void
  clearDiagnostics(): void
  updateStatus(detail: string): void
  requestRender(): void
  presentFrame(): number
  waitForPresentedFrame(afterSequence: number, signal?: AbortSignal, timeoutMs?: number): Promise<number>
  captureLastPresentedFramePng(): Promise<Blob | null>
  subscribePreviewBounds(listener: (bounds: StorybookPreviewBounds | null) => void): () => void
  mountSpacePreview(label: string, registration: StorybookSpacePreviewRegistration): StorybookSpacePreview
  applySpacePreviewGesture(
    node: SemanticNode,
    gesture: Readonly<{kind: "orbit" | "pan"; deltaX: number; deltaY: number}>,
  ): boolean
  dispatchNativeKey(target: SemanticHTMLElement, input: ExternalStorybookNativeKey): void
  dispose(): void
}>

type BoundStorybookSpacePreview = StorybookSpacePreview & Readonly<{
  suspend(): void
  resume(): void
  applyGesture(
    node: SemanticNode,
    gesture: Readonly<{kind: "orbit" | "pan"; deltaX: number; deltaY: number}>,
  ): boolean
}>

type StorybookViewPointSnapshot = Required<StorybookSpacePreviewCamera>

const spaceViewPointSnapshot = (
  camera: StorybookSpacePreviewCamera,
): StorybookViewPointSnapshot => Object.freeze({
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

/** Creates one page Experience with one Document, Canvas, Space, ViewPoint, Display and HUD. */
export async function createExternalStorybookShell(
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
  const createExperience = options.createExperience ?? createBrowserExperience
  const experience = await createExperience({
    canvas,
    font,
    styleSheets: Object.freeze([]),
    linkedAuthorStyleSheets: authorStyleSheetSources,
    cameraGestures: false,
    onLinkedAuthorStyleSheetError(error, source) {
      publishAuthorDiagnostic(Object.freeze({
        phase: "author-styles",
        message: error.message,
        source: source?.id ?? null,
      }))
    },
  })
  const document = experience.document
  const space = experience.space
  const viewPoint = experience.viewPoint
  const display = document.createElement("xr-display") as XRDisplayElement
  const hud = document.createElement("xr-hud") as XRHUDElement
  display.id = EXTERNAL_STORYBOOK_DISPLAY_ID
  hud.id = EXTERNAL_STORYBOOK_WORKBENCH_ID
  let workbench: Workbench
  try {
    document.transaction(() => {
      viewPoint.x = 0
      viewPoint.y = 0
      viewPoint.z = 1_000
      viewPoint.targetX = 0
      viewPoint.targetY = 0
      viewPoint.targetZ = 0
      viewPoint.upX = 0
      viewPoint.upY = 1
      viewPoint.upZ = 0
      viewPoint.far = 2_000
      space.append(display, hud)
    })
    workbench = createWorkbench({
      document,
      parent: hud,
      projectionHosts: {display, space},
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
        "scenarios.items": Object.freeze([]),
        "scenarios.active": null,
        status: {
          lead: "Создано для ",
          owner: options.statusOwner ?? "MetaFor",
          detail: " · External Storybook",
        },
      },
    })
  } catch (error) {
    experience.dispose()
    throw error
  }
  const displayProjection = experience.getProjection(display)
  const hudProjection = experience.getProjection(hud)
  const spaceProjection = experience.getProjection(space)
  const boundsListeners = new Set<(bounds: StorybookPreviewBounds | null) => void>()
  const frameWaiters = new Set<Readonly<{
    afterSequence: number
    resolve(sequence: number): void
  }>>()
  let unsubscribeFrame = (): void => {}
  let unsubscribePresented = (): void => {}
  let latestBounds: StorybookPreviewBounds | null = null
  let activeSpacePreview: BoundStorybookSpacePreview | null = null
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
    experience.requestFrame()
  }
  if (shellDiagnostics.length > 0) publishShellDiagnostics()

  const publishBounds = (bounds: StorybookPreviewBounds | null): void => {
    if (sameBounds(latestBounds, bounds)) return
    latestBounds = bounds
    for (const listener of [...boundsListeners]) listener(bounds)
  }
  try {
    unsubscribePresented = experience.subscribePresented(sequence => {
      for (const waiter of [...frameWaiters]) {
        if (sequence <= waiter.afterSequence) continue
        frameWaiters.delete(waiter)
        waiter.resolve(sequence)
      }
    })
    unsubscribeFrame = hudProjection.subscribeFrames(frame => {
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
    experience.render()
  } catch (error) {
    unsubscribeFrame()
    unsubscribePresented()
    workbench.dispose()
    experience.dispose()
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
    experience.requestFrame()
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
      throw new TypeError("Storybook Space preview registration.space is forbidden; use the one Experience Space")
    }
    activeSpacePreview?.dispose()
    activeShellPresentation?.dispose()
    activeShellPresentation = null
    mountPreviewNode(label, registration.node, "space")
    const initialViewPoint = spaceViewPointSnapshot(registration.camera)
    const restoredViewPoint = readViewPointSnapshot(viewPoint)
    writeViewPointSnapshot(document, viewPoint, initialViewPoint)
    const startedFrame = experience.presentedFrame
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
        return Math.max(0, experience.presentedFrame - startedFrame)
      },
      get disposed() {
        return previewDisposed
      },
      requestRender() {
        if (previewDisposed) throw new Error("Storybook Space preview is disposed")
        experience.requestFrame()
      },
      resetViewPoint() {
        if (previewDisposed) throw new Error("Storybook Space preview is disposed")
        writeViewPointSnapshot(document, viewPoint, initialViewPoint)
        experience.requestFrame()
      },
      suspend() {},
      resume() {
        if (previewDisposed) return
        writeViewPointSnapshot(document, viewPoint, initialViewPoint)
        applyBounds(latestBounds)
      },
      applyGesture(node, gesture) {
        if (
          previewDisposed ||
          registration.cameraGestures === false ||
          !(registration.node.contains(node) || node.contains(registration.node))
        ) return false
        if (gesture.kind === "orbit") {
          spaceProjection.orbit(gesture.deltaX, gesture.deltaY)
        } else {
          spaceProjection.pan(gesture.deltaX, gesture.deltaY)
        }
        return true
      },
      dispose() {
        if (previewDisposed) return
        previewDisposed = true
        unsubscribeBounds()
        unsubscribeBounds = () => {}
        if (!experience.disposed) {
          writeViewPointSnapshot(document, viewPoint, restoredViewPoint)
          experience.requestFrame()
        }
        if (activeSpacePreview === controller) activeSpacePreview = null
      },
    })
    activeSpacePreview = controller
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
  ): SemanticHTMLElement => mountShellPresentation(label, renderStorybookMarkdown({
    document,
    source,
    ...(baseUrl === undefined ? {} : {baseUrl}),
    ...(action === undefined ? {} : {action}),
  }))

  const projectionFor = (node: SemanticNode): ExperienceProjection => {
    if (node === display || display.contains(node)) return displayProjection
    if (node === hud || hud.contains(node)) return hudProjection
    if (node === space || space.contains(node)) return spaceProjection
    throw new Error("Storybook semantic node is outside the Experience Space")
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
    experience.dispatchKey(projection.owner, target, {type: "keydown", ...init})
    experience.dispatchKey(projection.owner, target, {type: "keyup", ...init})
  }

  const shell: ExternalStorybookShell = Object.freeze({
    document,
    browserDocument,
    canvas,
    experience,
    space,
    viewPoint,
    display,
    hud,
    workbench,
    get presentedFrameSequence() {
      return experience.presentedFrame
    },
    projectionFor,
    present(value) {
      assertActive(disposed)
      activeShellPresentation?.dispose()
      activeShellPresentation = null
      workbench.present(value)
      experience.requestFrame()
    },
    mountPreview,
    mountSpacePreview,
    showMessage,
    showMarkdown,
    reportDiagnostic(value) {
      assertActive(disposed)
      appendShellDiagnostic(value)
      experience.requestFrame()
    },
    clearDiagnostics() {
      assertActive(disposed)
      shellDiagnostics = []
      publishShellDiagnostics()
      experience.requestFrame()
    },
    updateStatus(detail) {
      assertActive(disposed)
      const current = workbench.controller.read("status")
      workbench.update("status", {
        ...current,
        lead: "Создано для ",
        owner: options.statusOwner ?? "MetaFor",
        detail: ` · ${detail}`,
      })
      experience.requestFrame()
    },
    requestRender() {
      assertActive(disposed)
      experience.requestFrame()
    },
    presentFrame() {
      assertActive(disposed)
      const before = experience.presentedFrame
      experience.render()
      if (experience.presentedFrame <= before) {
        throw new Error("Storybook renderer did not publish the synchronous frame")
      }
      return experience.presentedFrame
    },
    waitForPresentedFrame(afterSequence, signal, timeoutMs = 8_000) {
      assertActive(disposed)
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new TypeError("Presented frame sequence must be a non-negative integer")
      }
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
        throw new RangeError("Presented frame timeout must be between 1 and 30000 ms")
      }
      if (experience.presentedFrame > afterSequence) return Promise.resolve(experience.presentedFrame)
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
        else experience.requestFrame()
      })
    },
    captureLastPresentedFramePng() {
      assertActive(disposed)
      return experience.captureLastPresentedFramePng()
    },
    subscribePreviewBounds(listener) {
      assertActive(disposed)
      if (typeof listener !== "function") throw new TypeError("Preview bounds listener must be a function")
      boundsListeners.add(listener)
      listener(latestBounds)
      return () => boundsListeners.delete(listener)
    },
    applySpacePreviewGesture(node, gesture) {
      assertActive(disposed)
      return activeSpacePreview?.applyGesture(node, gesture) ?? false
    },
    dispatchNativeKey,
    dispose() {
      if (disposed) return
      disposed = true
      activeSpacePreview?.dispose()
      activeShellPresentation?.dispose()
      activeShellPresentation = null
      unsubscribeFrame()
      unsubscribePresented()
      boundsListeners.clear()
      for (const waiter of frameWaiters) waiter.resolve(experience.presentedFrame)
      frameWaiters.clear()
      experience.dispose()
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

function readViewPointSnapshot(viewPoint: XRViewPointElement): StorybookViewPointSnapshot {
  return Object.freeze({
    position: Object.freeze({x: viewPoint.x, y: viewPoint.y, z: viewPoint.z}),
    target: Object.freeze({
      x: viewPoint.targetX,
      y: viewPoint.targetY,
      z: viewPoint.targetZ,
    }),
    up: Object.freeze({x: viewPoint.upX, y: viewPoint.upY, z: viewPoint.upZ}),
    fov: viewPoint.fov,
    near: viewPoint.near,
    far: viewPoint.far,
  })
}

function writeViewPointSnapshot(
  document: SemanticDocument,
  viewPoint: XRViewPointElement,
  snapshot: StorybookViewPointSnapshot,
): void {
  document.transaction(() => {
    viewPoint.x = snapshot.position.x
    viewPoint.y = snapshot.position.y
    viewPoint.z = snapshot.position.z
    viewPoint.targetX = snapshot.target.x
    viewPoint.targetY = snapshot.target.y
    viewPoint.targetZ = snapshot.target.z
    viewPoint.upX = snapshot.up.x
    viewPoint.upY = snapshot.up.y
    viewPoint.upZ = snapshot.up.z
    viewPoint.fov = snapshot.fov
    viewPoint.near = snapshot.near
    viewPoint.far = snapshot.far
  })
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
        (presentation.projection !== "display" && presentation.projection !== "hud" &&
          presentation.projection !== "space") ||
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
