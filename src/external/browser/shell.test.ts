import {createRoot} from "@zavx0z/component"
import {describe, expect, test} from "bun:test"
import type {
  AttachOptions,
  Root,
  RootDocumentProjection,
  RootLinkedAuthorStyleSheet,
  RootProjection,
} from "@zavx0z/browser"
import {
  createDocument,
  type Element,
  type Node,
} from "@zavx0z/dom"
import {createDocumentRenderer, type RenderBox, type RenderFrame} from "@zavx0z/renderer"
import {
  createSpaceElementFactories,
  XRDisplayElement,
  XRHUDElement,
  XRSpaceElement,
  XRViewPointElement,
} from "@zavx0z/space"
import {
  EXTERNAL_STORYBOOK_DISPLAY_ID,
  EXTERNAL_STORYBOOK_WORKBENCH_ID,
  createExternalStorybookShell,
  type ExternalStorybookRootFactory,
} from "./shell.ts"

describe("external Storybook shared Browser Root", () => {
  test("creates one semantic Space/ViewPoint/Display/HUD and mounts the Workbench in HUD", async () => {
    const state = createFakeRootState()
    const shell = await createShell(state)

    expect(state.creations).toBe(1)
    expect(shell.document).toBe(shell.root.document)
    expect(shell.space).toBe(shell.root.space)
    expect(shell.viewPoint).toBe(shell.root.viewPoint)
    expect(shell.document.documentElement).toBe(shell.space)
    expect(shell.viewPoint.parentElement).toBe(shell.space)
    expect(viewPointValues(shell.viewPoint)).toMatchObject({
      x: 0,
      y: -1_000,
      z: 0,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      far: 2_000,
    })
    expect(shell.display).toBeInstanceOf(XRDisplayElement)
    expect(shell.display.id).toBe(EXTERNAL_STORYBOOK_DISPLAY_ID)
    expect(shell.hud).toBeInstanceOf(XRHUDElement)
    expect(shell.hud.id).toBe(EXTERNAL_STORYBOOK_WORKBENCH_ID)
    expect(shell.display.parentElement).toBe(shell.space)
    expect(shell.hud.parentElement).toBe(shell.space)
    expect(shell.workbench.element.parentElement).toBe(shell.hud)

    const displayNode = shell.document.createElement("button")
    shell.mountPreview("Display", displayNode)
    expect(displayNode.parentNode === shell.display).toBe(true)
    expect(shell.projectionFor(displayNode).kind).toBe("display")

    const hudNode = shell.document.createElement("button")
    shell.present({
      label: "HUD",
      presentation: {node: hudNode, projection: "hud"},
      inspectorSubject: null,
      inspectorValues: {},
    })
    expect(shell.workbench.elements.hudHost.firstChild).toBe(hudNode)
    expect(shell.hud.contains(hudNode)).toBeTrue()
    expect(shell.projectionFor(hudNode).kind).toBe("hud")

    const spaceNode = shell.document.createElement("xr-group")
    shell.present({
      label: "Space",
      presentation: {node: spaceNode, projection: "space"},
      inspectorSubject: null,
      inspectorValues: {},
    })
    expect(spaceNode.parentElement).toBe(shell.space)
    expect(shell.projectionFor(spaceNode).kind).toBe("space")
    shell.dispose()
  })

  test("passes exact linked author styles to createRoot", async () => {
    const state = createFakeRootState()
    const link = {} as HTMLLinkElement
    const shell = await createShell(state, {
      authorStyleSheetSources: [{id: "@zavx0z/ui/themes/theme.css", link}],
    })

    expect(state.options?.stylesheets).toEqual([{
      id: "@zavx0z/ui/themes/theme.css",
      link,
    }])
    expect(shell.viewPoint.controls).toBe(false)
    shell.dispose()
  })

  test("uses Root frames for bounds, acknowledgement and capture", async () => {
    const state = createFakeRootState()
    const shell = await createShell(state)
    const bounds: unknown[] = []
    const unsubscribe = shell.subscribePreviewBounds(value => bounds.push(value))
    state.emitFrame(shell.hud, shell.workbench.elements.previewHost, {
      contentX: 12,
      contentY: 18,
      contentWidth: 640,
      contentHeight: 360,
    })

    expect(bounds).toEqual([
      null,
      {x: 12, y: 18, width: 640, height: 360, viewportWidth: 1024, viewportHeight: 768},
    ])
    expect(shell.display.viewportWidth).toBe(640)
    expect(shell.display.viewportHeight).toBe(360)
    const scale = shell.display.worldUnitsPerPixel
    expect(scale).toBeCloseTo(2_000 * Math.tan(shell.viewPoint.fov / 2) / 768, 10)
    expect(shell.display.x / scale + 512 - 320).toBeCloseTo(12, 10)
    expect(384 - shell.display.z / scale - 180).toBeCloseTo(18, 10)
    const renderer = createDocumentRenderer({
      document: shell.document,
      root: shell.display,
      viewport: {width: 640, height: 360},
      styleSheets: ["xr-display { --widget-box-outline: #333333; }"],
    })
    const frame = renderer.flush()
    expect(frame.boxByNode.get(shell.display)).toMatchObject({
      width: 640, height: 360, contentX: 1, contentY: 1, contentWidth: 638, contentHeight: 358,
    })
    expect(frame.displayList.some(item => item.kind === "rect" && item.node === shell.display)).toBe(true)
    renderer.dispose()
    const display = shell.display
    state.emitFrame(shell.hud, shell.workbench.elements.previewHost, {
      contentX: 180, contentY: 40, contentWidth: 480, contentHeight: 280,
    })
    expect(shell.display === display).toBe(true)
    expect(display.viewportWidth).toBe(480)
    expect(display.viewportHeight).toBe(280)
    expect(display.x / display.worldUnitsPerPixel + 512 - 240).toBeCloseTo(180, 10)
    expect(384 - display.z / display.worldUnitsPerPixel - 140).toBeCloseTo(40, 10)
    const before = shell.presentedFrameSequence
    expect(shell.presentFrame()).toBeGreaterThan(before)
    expect(await shell.captureLastPresentedFramePng()).toBe(state.capture)
    unsubscribe()
    shell.dispose()
  })

  test("routes Space camera gestures through the semantic ViewPoint and restores its preset", async () => {
    const state = createFakeRootState()
    const shell = await createShell(state)
    const node = shell.document.createElement("xr-group")
    const restored = viewPointValues(shell.viewPoint)
    const preview = shell.mountSpacePreview("Space", {
      node,
      camera: {
        position: {x: 10, y: -20, z: 30},
        target: {x: 1, y: 2, z: 3},
      },
    })

    expect(node.parentElement).toBe(shell.space)
    expect(viewPointValues(shell.viewPoint)).toMatchObject({
      x: 10,
      y: -20,
      z: 30,
      targetX: 1,
      targetY: 2,
      targetZ: 3,
    })
    expect(shell.viewPoint.controls).toBe(true)
    preview.dispose()
    expect(viewPointValues(shell.viewPoint)).toEqual(restored)
    shell.dispose()
  })

  test("dispatches keys only through the exact active Display or HUD projection", async () => {
    const state = createFakeRootState()
    const shell = await createShell(state)
    const target = shell.document.createElement("button")
    shell.mountPreview("Key", target)
    state.pointerTarget = target
    const projection = shell.projectionFor(target)
    if (projection.kind === "space") throw new Error("Expected a document projection")
    shell.root.input.pointerDown({x: 1, y: 1})

    shell.dispatchNativeKey(target, {
      key: "Enter",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    })
    expect(state.keys.map(({input}) => input.type)).toEqual(["keydown", "keyup"])
    expect(state.keys.every(({owner, target: keyTarget}) =>
      owner === shell.display && keyTarget === target)).toBeTrue()
    shell.dispose()
  })

  test("keeps landing and package shells as separate Roots", async () => {
    const landingState = createFakeRootState()
    const packageState = createFakeRootState()
    const landing = await createShell(landingState)
    const packageShell = await createShell(packageState)

    expect(landing.root).not.toBe(packageShell.root)
    expect(landing.document).not.toBe(packageShell.document)
    expect(landing.space).not.toBe(packageShell.space)
    landing.dispose()
    packageShell.dispose()
  })

  test("releases the Root when its first presented frame fails", async () => {
    const state = createFakeRootState()
    state.renderError = new Error("first frame failed")

    await expect(createShell(state)).rejects.toThrow("first frame failed")
    expect(state.root?.disposed).toBeTrue()
  })
})

type FakeRootState = {
  creations: number
  options: AttachOptions | null
  root: Root | null
  pointerTarget: Element | null
  activeOwner: XRDisplayElement | XRHUDElement | null
  activeTarget: Element | null
  keys: Array<Readonly<{
    owner: XRDisplayElement | XRHUDElement
    target: Element
    input: Readonly<{type: "keydown" | "keyup"; key: string}>
  }>>
  spaceGestures: Array<Readonly<{
    kind: "orbit" | "pan"
    deltaX: number
    deltaY: number
  }>>
  capture: Blob
  renderError: Error | null
  emitFrame(
    owner: XRDisplayElement | XRHUDElement,
    node: Node,
    box: Readonly<{
      contentX: number
      contentY: number
      contentWidth: number
      contentHeight: number
    }>,
  ): void
}

function createFakeRootState(): FakeRootState {
  return {
    creations: 0,
    options: null,
    root: null,
    pointerTarget: null,
    activeOwner: null,
    activeTarget: null,
    keys: [],
    spaceGestures: [],
    capture: new Blob(["capture"], {type: "image/png"}),
    renderError: null,
    emitFrame() {
      throw new Error("Fake Root is not created")
    },
  }
}

async function createShell(
  state: FakeRootState,
  options: Readonly<{
    authorStyleSheetSources?: readonly RootLinkedAuthorStyleSheet[]
  }> = {},
) {
  return createExternalStorybookShell({
    title: "Fixture Storybook",
    browserDocument: {} as globalThis.Document,
    canvas: {width: 1024, height: 768} as HTMLCanvasElement,
    loadFont: async () => ({}) as never,
    attach: fakeRootFactory(state),
    ...(options.authorStyleSheetSources === undefined
      ? {}
      : {authorStyleSheetSources: options.authorStyleSheetSources}),
  })
}

function fakeRootFactory(state: FakeRootState): ExternalStorybookRootFactory {
  return async options => {
    state.creations += 1
    state.options = options
    const document = createDocument({elementFactories: createSpaceElementFactories()})
    const appRoot = createRoot(document)
    appRoot.render(options.app)
    appRoot.flush()
    const space = document.documentElement as XRSpaceElement
    const viewPoint = space.querySelector("xr-view-point") as XRViewPointElement
    const projections = new Map<XRDisplayElement | XRHUDElement, RootDocumentProjection>()
    const frames = new Map<XRDisplayElement | XRHUDElement, RenderFrame>()
    const frameListeners = new Map<XRDisplayElement | XRHUDElement, Set<(frame: RenderFrame) => void>>()
    const presented = new Set<(sequence: number) => void>()
    let sequence = 0
    let disposed = false

    const documentProjection = (
      owner: XRDisplayElement | XRHUDElement,
    ): RootDocumentProjection => {
      let projection = projections.get(owner)
      if (projection !== undefined) return projection
      projection = Object.freeze({
        kind: owner instanceof XRDisplayElement ? "display" as const : "hud" as const,
        owner,
        projectPoint: (point: {x: number; y: number}) => point,
        readFrame: () => frames.get(owner) ?? fakeFrame(document, owner),
        subscribeFrames(listener: (frame: RenderFrame) => void) {
          let listeners = frameListeners.get(owner)
          if (listeners === undefined) {
            listeners = new Set()
            frameListeners.set(owner, listeners)
          }
          listeners.add(listener)
          return () => listeners?.delete(listener)
        },
        pointerDown() {
          state.activeOwner = owner
          state.activeTarget = state.pointerTarget
          return state.pointerTarget
        },
        pointerMove: () => state.pointerTarget,
        pointerUp: () => state.pointerTarget,
        wheel: () => state.pointerTarget,
      })
      projections.set(owner, projection)
      return projection
    }
    const spaceProjection = Object.freeze({
      kind: "space" as const,
      owner: space,
      orbit(deltaX: number, deltaY: number) {
        state.spaceGestures.push({kind: "orbit", deltaX, deltaY})
      },
      pan(deltaX: number, deltaY: number) {
        state.spaceGestures.push({kind: "pan", deltaX, deltaY})
      },
      zoom() {},
    })
    const getProjection = (
      owner: XRSpaceElement | XRDisplayElement | XRHUDElement,
    ): RootProjection => owner instanceof XRSpaceElement
      ? spaceProjection
      : documentProjection(owner)
    const root = Object.freeze({
      input: {
        pointerDown() {
          state.activeTarget = state.pointerTarget
          state.activeOwner = state.pointerTarget?.parentElement as XRDisplayElement | XRHUDElement
        },
        pointerMove() {},
        pointerUp() {},
        pointerCancel() {},
        wheel() {},
      },
      canvas: options.canvas,
      document,
      space,
      viewPoint,
      get presentedFrame() { return sequence },
      get disposed() { return disposed },
      getProjection,
      subscribePresented(listener: (value: number) => void) {
        presented.add(listener)
        return () => presented.delete(listener)
      },
      dispatchKey(owner: XRDisplayElement | XRHUDElement, target: Element, input: any) {
        if (state.activeOwner !== owner || state.activeTarget !== target) {
          throw new Error("Semantic key target does not own the Root native proxy")
        }
        state.keys.push({owner, target, input})
        return true
      },
      resetViewPoint() {},
      render() {
        if (state.renderError !== null) throw state.renderError
        sequence += 1
        for (const listener of presented) listener(sequence)
      },
      invalidate() {},
      resize() {},
      captureLastPresentedFramePng: async () => state.capture,
      unmount() {
        disposed = true
        appRoot.unmount()
      },
    }) as unknown as Root
    state.root = root
    state.emitFrame = (owner, node, box) => {
      const renderBox = {
        node,
        x: box.contentX,
        y: box.contentY,
        width: box.contentWidth,
        height: box.contentHeight,
        ...box,
      } as RenderBox
      const frame = fakeFrame(document, owner, new Map([[node, renderBox]]))
      frames.set(owner, frame)
      for (const listener of frameListeners.get(owner) ?? []) listener(frame)
    }
    return root
  }
}

function fakeFrame(
  document: ReturnType<typeof createDocument>,
  root: Node,
  boxByNode: ReadonlyMap<Node, RenderBox> = new Map(),
): RenderFrame {
  return {
    revision: 1,
    document,
    root,
    viewport: {width: 1024, height: 768},
    boxes: Object.freeze([...boxByNode.values()]),
    boxByNode,
    displayList: Object.freeze([]),
    hits: new Map(),
    scrolls: new Map(),
  }
}

function viewPointValues(viewPoint: XRViewPointElement) {
  return {
    x: viewPoint.x,
    y: viewPoint.y,
    z: viewPoint.z,
    targetX: viewPoint.targetX,
    targetY: viewPoint.targetY,
    targetZ: viewPoint.targetZ,
    fov: viewPoint.fov,
    near: viewPoint.near,
    far: viewPoint.far,
  }
}
