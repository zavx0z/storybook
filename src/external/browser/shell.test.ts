import {describe, expect, test} from "bun:test"
import {Space} from "@engine/core"
import {createDocument, type Element, type Node} from "@zavx0z/dom"
import type {
  DocumentOverlayRuntime,
  DocumentSpaceRuntime,
  DocumentSpaceWorldRuntime,
} from "@zavx0z/renderer-browser"
import {
  EXTERNAL_STORYBOOK_OWNER_WORLD_ID,
  EXTERNAL_STORYBOOK_WORKBENCH_OVERLAY_ID,
  createExternalStorybookShell,
  type ExternalStorybookShellSpaceRuntimeFactory,
} from "./shell.ts"

describe("external Storybook shared browser shell", () => {
  test("owns one semantic Workbench and renderer while exposing same-document host seams", async () => {
    const runtimes: FakeRuntime[] = []
    const document = createDocument()
    const shell = await createExternalStorybookShell({
      title: "Fixture Storybook",
      document,
      browserDocument: {} as globalThis.Document,
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      createSpaceRuntime: fakeRuntimeFactory(runtimes),
    })

    expect(shell.document).toBe(document)
    expect(shell.workbench.document).toBe(document)
    expect(shell.workbench.element).toBe(document.documentElement as typeof shell.workbench.element)
    expect(runtimes).toHaveLength(1)
    const firstRuntime = runtimes[0]!
    expect(firstRuntime.options.document).toBe(document)
    expect(firstRuntime.options.cameraGestures).toBeFalse()
    expect(firstRuntime.overlayId).toBe(EXTERNAL_STORYBOOK_WORKBENCH_OVERLAY_ID)
    expect(firstRuntime.overlayRoot).toBe(shell.workbench.element)
    expect(shell.runtime).toBe(firstRuntime.runtime)
    expect(shell.workbenchOverlay).toBe(firstRuntime.overlay!)
    expect(shell.runtime.document).toBe(document)
    expect(shell.workbenchOverlay.document).toBe(document)
    expect(shell.presentFrame()).toBeGreaterThan(1)

    const preview = document.createElement("button")
    preview.textContent = "Owner preview"
    shell.mountPreview("Owner", preview)
    expect(shell.workbench.elements.previewHost.firstChild).toBe(preview)
    expect(runtimes[0]?.requests).toBeGreaterThan(0)
    expect(() => shell.mountPreview("Foreign", createDocument().createElement("div")))
      .toThrow("another Document")

    shell.publishInspector({kind: "owner"})
    shell.publishSource({typescript: "export const story = true"})
    shell.publishProps({disabled: false})
    shell.reportDiagnostic("fixture diagnostic")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("Inspector")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("Source")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("Props")
    expect(shell.workbench.elements.inspectorHost.textContent).toContain("fixture diagnostic")

    const bounds: unknown[] = []
    const unsubscribe = shell.subscribePreviewBounds((value) => bounds.push(value))
    runtimes[0]?.emit(shell.workbench.elements.previewHost, {
      contentX: 12,
      contentY: 18,
      contentWidth: 640,
      contentHeight: 360,
    })
    expect(bounds).toEqual([
      null,
      {x: 12, y: 18, width: 640, height: 360, viewportWidth: 1024, viewportHeight: 768},
    ])
    unsubscribe()

    const worldNode = document.createElement("section")
    const worldSpace = new Space()
    const worldResizes: unknown[] = []
    const worldPreview = shell.mountWorldPreview("Engine", {
      node: worldNode,
      space: worldSpace,
      camera: {
        position: {x: 10, y: -20, z: 30},
        target: {x: 0, y: 0, z: 0},
      },
      resize: (viewport) => worldResizes.push(viewport),
    })
    expect(shell.workbench.elements.previewHost.firstChild).toBe(worldNode)
    expect(shell.workbench.element.hasAttribute("data-storybook-world-preview")).toBeTrue()
    expect(runtimes[0]?.worldId).toBe(EXTERNAL_STORYBOOK_OWNER_WORLD_ID)
    expect(runtimes[0]?.worldSpace).toBe(worldSpace)
    expect(runtimes[0]?.worldViewport).toEqual({x: 12, y: 18, width: 640, height: 360})
    expect(worldResizes.at(-1)).toEqual({
      x: 12,
      y: 18,
      width: 640,
      height: 360,
      backingX: 12,
      backingY: 18,
      backingWidth: 640,
      backingHeight: 360,
      pixelRatio: 1,
    })
    expect(shell.applyWorldPreviewGesture(worldNode, {
      kind: "orbit",
      deltaX: 12,
      deltaY: -7,
    })).toBeTrue()
    expect(runtimes[0]?.worldOrbits).toEqual([[12, -7]])
    expect(shell.applyWorldPreviewGesture(document.createElement("div"), {
      kind: "pan",
      deltaX: 1,
      deltaY: 2,
    })).toBeFalse()
    worldPreview.requestRender()
    expect(runtimes[0]?.requests).toBeGreaterThan(0)

    await shell.setOwnerStyleSheets([".owner { color: red; }"])
    expect(runtimes).toHaveLength(2)
    expect(runtimes[0]?.disposed).toBeTrue()
    expect(runtimes[1]?.options.styleSheets).toContain(".owner { color: red; }")
    expect(runtimes[1]?.worldSpace).toBe(worldSpace)
    expect(worldPreview.disposed).toBeFalse()
    shell.showMessage("Overview", "Overview", "No direct world")
    expect(worldPreview.disposed).toBeTrue()
    expect(shell.workbench.element.hasAttribute("data-storybook-world-preview")).toBeFalse()
    expect(runtimes[1]?.worldRemoves).toBe(1)
    shell.dispose()
    expect(runtimes[1]?.disposed).toBeTrue()
    expect(shell.workbench.element.parentNode).toBeNull()
  })

  test("renders bounded Markdown and unknown HTML as inert text", async () => {
    const shell = await createExternalStorybookShell({
      title: "Fixture Storybook",
      document: createDocument(),
      browserDocument: {} as globalThis.Document,
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      createSpaceRuntime: fakeRuntimeFactory([]),
    })
    const markdown = shell.showMarkdown(
      "README",
      "# Owner\n\n<script>globalThis.pwned = true</script>\n\n- item",
      "http://localhost/resource",
    )
    expect(markdown.textContent).toContain("Owner")
    expect(markdown.textContent).toContain("<script>globalThis.pwned = true</script>")
    expect(descendants(markdown).some((node) => node.nodeName === "SCRIPT")).toBeFalse()
    shell.dispose()
  })

  test("keeps landing and package pages as separate Experiences", async () => {
    const runtimes: FakeRuntime[] = []
    const landingDocument = createDocument()
    const packageDocument = createDocument()
    const landingCanvas = {} as HTMLCanvasElement
    const packageCanvas = {} as HTMLCanvasElement
    const createSpaceRuntime = fakeRuntimeFactory(runtimes)
    const landing = await createExternalStorybookShell({
      title: "Landing",
      document: landingDocument,
      browserDocument: {} as globalThis.Document,
      canvas: landingCanvas,
      loadFont: async () => ({}) as never,
      createSpaceRuntime,
    })
    const packageShell = await createExternalStorybookShell({
      title: "Package",
      document: packageDocument,
      browserDocument: {} as globalThis.Document,
      canvas: packageCanvas,
      loadFont: async () => ({}) as never,
      createSpaceRuntime,
    })

    expect(landing.document).toBe(landingDocument)
    expect(packageShell.document).toBe(packageDocument)
    expect(landing.runtime.document).toBe(landingDocument)
    expect(packageShell.runtime.document).toBe(packageDocument)
    expect(landing.canvas).toBe(landingCanvas)
    expect(packageShell.canvas).toBe(packageCanvas)
    expect(landing.runtime).not.toBe(packageShell.runtime)
    expect(landing.workbenchOverlay.root).toBe(landing.workbench.element)
    expect(packageShell.workbenchOverlay.root).toBe(packageShell.workbench.element)

    landing.dispose()
    packageShell.dispose()
  })
})

type FakeRuntime = {
  options: Parameters<ExternalStorybookShellSpaceRuntimeFactory>[0]
  runtime: DocumentSpaceRuntime
  overlay: DocumentOverlayRuntime | null
  overlayId: string | null
  overlayRoot: Node | null
  worldId: string | null
  worldSpace: Space | null
  worldViewport: Readonly<{x: number; y: number; width: number; height: number}> | null
  worldOrbits: Array<readonly [number, number]>
  worldRemoves: number
  requests: number
  disposed: boolean
  emit(node: Node, box: Readonly<{
    contentX: number
    contentY: number
    contentWidth: number
    contentHeight: number
  }>): void
}

function fakeRuntimeFactory(output: FakeRuntime[]): ExternalStorybookShellSpaceRuntimeFactory {
  return (async (options) => {
    const subscribers = new Set<(frame: any) => void>()
    const presentedSubscribers = new Set<(frame: number) => void>()
    let presentedFrames = 0
    let currentFrame: any = frame(options.document, options.document, options.styleSheets)
    let overlay: DocumentOverlayRuntime | null = null
    let overlayId: string | null = null
    let overlayRoot: Node | null = null
    let world: DocumentSpaceWorldRuntime | null = null
    const owner: FakeRuntime = {
      options,
      runtime: null as unknown as DocumentSpaceRuntime,
      overlay,
      overlayId,
      overlayRoot,
      worldId: null,
      worldSpace: null,
      worldViewport: null,
      worldOrbits: [],
      worldRemoves: 0,
      requests: 0,
      disposed: false,
      emit(node, box) {
        currentFrame = frame(options.document, overlayRoot ?? options.document, options.styleSheets, node, box)
        for (const subscriber of subscribers) subscriber(currentFrame)
      },
    }
    const runtime = {
      document: options.document,
      styleSheets: options.styleSheets,
      font: options.font,
      addOverlay(registration: Readonly<{id: string; root: Node}>) {
        overlayId = registration.id
        overlayRoot = registration.root
        overlay = {
          document: options.document,
          root: registration.root,
          styleSheets: options.styleSheets,
          font: options.font,
          get frame() { return currentFrame },
          subscribe(listener: (frame: any) => void) {
            subscribers.add(listener)
            return () => subscribers.delete(listener)
          },
          dispose() {
            subscribers.clear()
          },
        } as unknown as DocumentOverlayRuntime
        owner.overlay = overlay
        owner.overlayId = overlayId
        owner.overlayRoot = overlayRoot
        return overlay
      },
      addWorld(registration: any) {
        owner.worldId = registration.id
        owner.worldSpace = registration.space
        owner.worldViewport = registration.viewport
        const notifyResize = () => registration.onResize?.(owner.worldViewport === null ? null : {
          logicalViewport: owner.worldViewport,
          backingViewport: owner.worldViewport,
          pixelRatio: 1,
        })
        world = {
          id: registration.id,
          space: registration.space,
          get viewport() { return owner.worldViewport },
          viewPoint: {
            orbit(deltaX: number, deltaY: number) {
              owner.worldOrbits.push([deltaX, deltaY])
            },
            pan() {},
          },
          get disposed() { return owner.disposed },
          requestRender() { owner.requests += 1 },
        } as unknown as DocumentSpaceWorldRuntime
        notifyResize()
        return world
      },
      updateWorld(_id: string, update: any) {
        if ("viewport" in update) owner.worldViewport = update.viewport
        return world!
      },
      removeWorld() {
        if (world === null) return false
        owner.worldRemoves += 1
        world = null
        owner.worldId = null
        owner.worldSpace = null
        owner.worldViewport = null
        return true
      },
      render() {
        for (const subscriber of subscribers) subscriber(currentFrame)
        presentedFrames += 1
        for (const subscriber of presentedSubscribers) subscriber(presentedFrames)
      },
      subscribePresented(listener: (frame: number) => void) {
        presentedSubscribers.add(listener)
        return () => presentedSubscribers.delete(listener)
      },
      requestRender() {
        owner.requests += 1
      },
      dispose() {
        owner.disposed = true
        world = null
        subscribers.clear()
        presentedSubscribers.clear()
      },
      get disposed() { return owner.disposed },
    } as unknown as DocumentSpaceRuntime
    owner.runtime = runtime
    output.push(owner)
    return runtime
  }) as ExternalStorybookShellSpaceRuntimeFactory
}

function frame(
  document: ReturnType<typeof createDocument>,
  root: Node,
  _styleSheets: readonly string[],
  node?: Node,
  box?: Readonly<{
    contentX: number
    contentY: number
    contentWidth: number
    contentHeight: number
  }>,
) {
  return {
    document,
    root,
    viewport: {width: 1024, height: 768},
    boxByNode: node === undefined || box === undefined ? new Map() : new Map([[node, box]]),
  }
}

function descendants(root: Node): Element[] {
  const output: Element[] = []
  for (const child of root.childNodes) {
    if (!("localName" in child)) continue
    output.push(child as Element, ...descendants(child))
  }
  return output
}
