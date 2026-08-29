/** One semantic Workbench Experience projected into a camera-locked overlay. */

import {loadDocumentDefaultFont} from "@engine/core/default-font"
import {
  createDocument,
  type Document as SemanticDocument,
  type HTMLElement as SemanticElement,
  type Node as SemanticNode,
} from "@zavx0z/dom"
import {
  createDocumentSpaceRuntime,
  type DocumentOverlayRuntime,
  type DocumentSpaceRuntime,
  type DocumentSpaceViewPointSnapshot,
} from "@zavx0z/renderer-browser"
import {
  createStorybookDomWorkbench,
  storybookDomWorkbenchCss,
  type StorybookDomWorkbench,
} from "../../dom/workbench.ts"
import {
  EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
  type ExternalStorybookClientNode,
  type ExternalStorybookClientSnapshot,
} from "./client-protocol.ts"
import {
  renderStorybookMarkdown,
  storybookMarkdownCss,
} from "../markdown.ts"
import type {
  StorybookPreviewBounds,
  StorybookWorldPreview,
  StorybookWorldPreviewCamera,
  StorybookWorldPreviewRegistration,
} from "../runtime-protocol.ts"

export const EXTERNAL_STORYBOOK_CANVAS_ID = "external-storybook-canvas" as const
export const EXTERNAL_STORYBOOK_WORKBENCH_OVERLAY_ID = "external-storybook-workbench" as const
export const EXTERNAL_STORYBOOK_OWNER_WORLD_ID = "external-storybook-owner-world" as const

export type ExternalStorybookShellSpaceRuntimeFactory =
  typeof createDocumentSpaceRuntime

export type CreateExternalStorybookShellOptions = Readonly<{
  title: string
  browserDocument?: globalThis.Document
  canvas?: HTMLCanvasElement
  document?: SemanticDocument
  statusOwner?: string
  loadFont?: typeof loadDocumentDefaultFont
  createSpaceRuntime?: ExternalStorybookShellSpaceRuntimeFactory
}>

export type ExternalStorybookShell = Readonly<{
  document: SemanticDocument
  browserDocument: globalThis.Document
  canvas: HTMLCanvasElement
  workbench: StorybookDomWorkbench
  readonly runtime: DocumentSpaceRuntime
  readonly workbenchOverlay: DocumentOverlayRuntime
  readonly presentedFrameSequence: number
  mountPreview(label: string, node: SemanticNode): void
  showMessage(label: string, title: string, detail: string): SemanticElement
  showMarkdown(label: string, source: string, baseUrl?: string): SemanticElement
  publishInspector(value: unknown): void
  publishSource(value: unknown): void
  publishProps(value: unknown): void
  reportDiagnostic(value: unknown): void
  clearDiagnostics(): void
  updateStatus(detail: string): void
  requestRender(): void
  presentFrame(): number
  waitForPresentedFrame(afterSequence: number, signal?: AbortSignal, timeoutMs?: number): Promise<number>
  captureLastPresentedFramePng(): Promise<Blob | null>
  setOwnerStyleSheets(styleSheets: readonly string[]): Promise<void>
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

const externalShellCss = `
.external-storybook-inspector { box-sizing: border-box; display: flex; flex-direction: column; width: 100%; height: 100%; gap: 4px; padding: 6px; overflow: auto; border: 1px solid #111111; border-radius: 6px; background: #292929; color: #d8d8d8; }
.external-storybook-inspector__section { box-sizing: border-box; display: flex; flex-direction: column; width: 100%; gap: 2px; padding: 4px; border: 1px solid #181818; border-radius: 3px; background: #242424; }
.external-storybook-inspector__heading { display: block; margin: 0; color: #9fcbe0; font-size: 11px; }
.external-storybook-inspector__value { display: block; margin: 0; color: #c8c8c8; font-size: 10px; white-space: pre; overflow: auto; }
.external-storybook-message { box-sizing: border-box; display: flex; flex-direction: column; width: 100%; min-height: 180px; gap: 8px; padding: 18px; border: 1px solid #30343c; border-radius: 4px; background: #202124; color: #e8e8e8; }
.external-storybook-message__title { display: block; margin: 0; color: #7edcec; font-size: 16px; }
.external-storybook-message__detail { display: block; margin: 0; color: #b8b8b8; font-size: 12px; white-space: normal; }
.external-storybook-action { box-sizing: border-box; display: block; min-height: 30px; padding: 5px 10px; border: 1px solid #31566a; border-radius: 3px; background: #274655; color: #e8f7ff; font-size: 11px; }
`.trim()

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
  const inspector = createInspector(document)
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
      "preview.node": null,
      "scenarios.label": "Варианты",
      "scenarios.items": Object.freeze([]),
      "scenarios.active": null,
      "inspector.node": inspector.element,
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
  let ownerStyleSheets = Object.freeze([]) as readonly string[]
  let runtime!: DocumentSpaceRuntime
  let workbenchOverlay!: DocumentOverlayRuntime
  let unsubscribeFrame = (): void => {}
  let unsubscribePresented = (): void => {}
  let latestBounds: StorybookPreviewBounds | null = null
  let presentedFrameSequence = 0
  let activeWorldPreview: BoundStorybookWorldPreview | null = null
  let disposed = false

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
    if (runtime !== undefined) runtime.dispose()
    runtime = await createRuntime({
      canvas,
      document,
      styleSheets: Object.freeze([
        storybookDomWorkbenchCss,
        storybookMarkdownCss,
        externalShellCss,
        ...ownerStyleSheets,
      ]),
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
  await startExperienceHost()
  markShellPhase(browserDocument, "ready")

  const mountPreviewNode = (label: string, node: SemanticNode): void => {
    assertActive(disposed)
    document.transaction(() => {
      workbench.update("preview.label", label)
      workbench.update("preview.node", node)
    })
    runtime.requestRender()
  }
  const mountPreview = (label: string, node: SemanticNode): void => {
    activeWorldPreview?.dispose()
    mountPreviewNode(label, node)
  }
  const mountWorldPreview = (
    label: string,
    registration: StorybookWorldPreviewRegistration,
  ): StorybookWorldPreview => {
    assertActive(disposed)
    activeWorldPreview?.dispose()
    workbench.element.setAttribute("data-storybook-world-preview", "")
    mountPreviewNode(label, registration.node)
    const initialViewPoint = worldViewPointSnapshot(registration.camera)
    const startedFrame = presentedFrameSequence
    let worldHost: DocumentSpaceRuntime | null = null
    let world: ReturnType<DocumentSpaceRuntime["addWorld"]> | null = null
    let previewDisposed = false
    let unsubscribeBounds = (): void => {}
    let controller!: BoundStorybookWorldPreview

    const detach = (): void => {
      const host = worldHost
      worldHost = null
      world = null
      if (host === null || host.disposed) return
      host.removeWorld(EXTERNAL_STORYBOOK_OWNER_WORLD_ID)
    }
    const applyBounds = (bounds: StorybookPreviewBounds | null): void => {
      if (previewDisposed || disposed) return
      const viewport = bounds === null || bounds.width <= 0 || bounds.height <= 0
        ? null
        : Object.freeze({x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height})
      if (world === null) {
        worldHost = runtime
        world = runtime.addWorld({
          id: EXTERNAL_STORYBOOK_OWNER_WORLD_ID,
          space: registration.space,
          viewport,
          viewPoint: initialViewPoint,
          cameraGestures: registration.cameraGestures ?? true,
          onResize(value) {
            if (value === null || registration.resize === undefined) return
            registration.resize(Object.freeze({
              x: value.logicalViewport.x,
              y: value.logicalViewport.y,
              width: value.logicalViewport.width,
              height: value.logicalViewport.height,
              backingX: value.backingViewport.x,
              backingY: value.backingViewport.y,
              backingWidth: value.backingViewport.width,
              backingHeight: value.backingViewport.height,
              pixelRatio: value.pixelRatio,
            }))
          },
          ...(registration.onDoubleClick === undefined
            ? {}
            : {onDoubleClick: registration.onDoubleClick}),
        })
        return
      }
      runtime.updateWorld(EXTERNAL_STORYBOOK_OWNER_WORLD_ID, {viewport})
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
        world?.requestRender()
      },
      resetViewPoint() {
        if (previewDisposed) throw new Error("Storybook world preview is disposed")
        if (world !== null) runtime.updateWorld(EXTERNAL_STORYBOOK_OWNER_WORLD_ID, {
          viewPoint: initialViewPoint,
        })
      },
      suspend: detach,
      resume() {
        if (!previewDisposed) applyBounds(latestBounds)
      },
      applyGesture(node, gesture) {
        if (
          previewDisposed ||
          world === null ||
          !(registration.node.contains(node) || node.contains(registration.node))
        ) return false
        if (gesture.kind === "orbit") {
          world.viewPoint.orbit(gesture.deltaX, gesture.deltaY)
        } else {
          world.viewPoint.pan(gesture.deltaX, gesture.deltaY)
        }
        world.requestRender()
        return true
      },
      dispose() {
        if (previewDisposed) return
        previewDisposed = true
        unsubscribeBounds()
        unsubscribeBounds = () => {}
        detach()
        workbench.element.removeAttribute("data-storybook-world-preview")
        if (activeWorldPreview === controller) activeWorldPreview = null
      },
    })
    activeWorldPreview = controller
    boundsListeners.add(applyBounds)
    unsubscribeBounds = () => boundsListeners.delete(applyBounds)
    applyBounds(latestBounds)
    return controller
  }
  const showMessage = (label: string, title: string, detail: string): SemanticElement => {
    const element = message(document, title, detail)
    mountPreview(label, element)
    return element
  }
  const showMarkdown = (label: string, source: string, baseUrl?: string): SemanticElement => {
    const node = renderStorybookMarkdown({
      document,
      source,
      ...(baseUrl === undefined ? {} : {baseUrl}),
    })
    mountPreview(label, node)
    return node
  }

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
    mountPreview,
    mountWorldPreview,
    showMessage,
    showMarkdown,
    publishInspector(value) {
      assertActive(disposed)
      inspector.update("Inspector", value)
      runtime.requestRender()
    },
    publishSource(value) {
      assertActive(disposed)
      inspector.update("Source", value)
      runtime.requestRender()
    },
    publishProps(value) {
      assertActive(disposed)
      inspector.update("Props", value)
      runtime.requestRender()
    },
    reportDiagnostic(value) {
      assertActive(disposed)
      inspector.diagnostic(value)
      runtime.requestRender()
    },
    clearDiagnostics() {
      assertActive(disposed)
      inspector.clearDiagnostics()
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
    async setOwnerStyleSheets(styleSheets) {
      assertActive(disposed)
      if (!Array.isArray(styleSheets) || styleSheets.some((sheet) => typeof sheet !== "string")) {
        throw new TypeError("External Storybook owner styleSheets must be a string list")
      }
      const next = Object.freeze([...styleSheets])
      if (JSON.stringify(next) === JSON.stringify(ownerStyleSheets)) return
      ownerStyleSheets = next
      await startExperienceHost()
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
      unsubscribeFrame()
      unsubscribePresented()
      boundsListeners.clear()
      for (const waiter of frameWaiters) waiter.resolve(presentedFrameSequence)
      frameWaiters.clear()
      runtime.dispose()
      workbench.dispose()
    },
  })
  return shell
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

function createInspector(document: SemanticDocument) {
  const element = document.createElement("aside")
  element.className = "external-storybook-inspector"
  element.setAttribute("aria-label", "Inspector")
  const sections = new Map<string, SemanticElement>()
  const ensure = (label: string): SemanticElement => {
    const current = sections.get(label)
    if (current !== undefined) return current
    const section = document.createElement("section")
    section.className = "external-storybook-inspector__section"
    const heading = document.createElement("h3")
    heading.className = "external-storybook-inspector__heading"
    heading.textContent = label
    const value = document.createElement("pre")
    value.className = "external-storybook-inspector__value"
    section.append(heading, value)
    element.appendChild(section)
    sections.set(label, value)
    return value
  }
  return Object.freeze({
    element,
    update(label: string, value: unknown) {
      ensure(label).textContent = printable(value)
    },
    diagnostic(value: unknown) {
      const target = ensure("Diagnostics")
      const next = printable(value)
      target.textContent = target.textContent.length === 0 ? next : `${target.textContent}\n${next}`
    },
    clearDiagnostics() {
      ensure("Diagnostics").textContent = ""
    },
  })
}

function message(document: SemanticDocument, title: string, detail: string): SemanticElement {
  const element = document.createElement("article")
  element.className = "external-storybook-message"
  const heading = document.createElement("h1")
  heading.className = "external-storybook-message__title"
  heading.textContent = title
  const paragraph = document.createElement("p")
  paragraph.className = "external-storybook-message__detail"
  paragraph.textContent = detail
  element.append(heading, paragraph)
  return element
}

function printable(value: unknown): string {
  if (typeof value === "string") return value
  try {
    const result = JSON.stringify(value, null, 2)
    return result ?? String(value)
  } catch {
    return String(value)
  }
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
