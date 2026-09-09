import {DisplayElement} from "@zavx0z/dom/display"
import {presentationRootFixture, type PresentationFixtureOptions} from "./browser-root.fixture.ts"
import {createRoot} from "@zavx0z/component"
import {createDocumentClipboardController} from "@zavx0z/browser/clipboard"
import {describe, expect, test} from "bun:test"
import {ViewPoint, Vector3} from "@zavx0z/engine"
import type {
  Presentation as Root,
  RootDocumentProjection,
  RootLinkedAuthorStyleSheet,
  RootProjection,
} from "@zavx0z/browser/integration"
import {
  createDocument,
  type Element,
  type Node,
} from "@zavx0z/dom"
import {readDisplayStyle, createDocumentRenderer, type RenderBox, type RenderFrame} from "@zavx0z/renderer"
import {createSpaceElementFactories} from "@zavx0z/space"
import {HUDElement} from "../../webxr-space/dom/hud/index.ts"
import {SpaceElement} from "@zavx0z/dom/space"
import {ViewPointElement} from "@zavx0z/dom/viewpoint"
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
    expect(shell.document.documentElement?.localName).toBe("html")
    expect(shell.space.parentElement?.localName).toBe("body")
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
    expect(shell.display).toBeInstanceOf(DisplayElement)
    expect(shell.display.id).toBe(EXTERNAL_STORYBOOK_DISPLAY_ID)
    expect(shell.hud).toBeInstanceOf(HUDElement)
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
    expect(state.options?.stylesheets).toHaveLength(1)
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
    const surface = readDisplayStyle(shell.document, shell.display)
    expect(surface.viewport).toEqual({width: 640, height: 360})
    expect(shell.display.width).toBeCloseTo(640 * 25.4 / 96)
    expect(shell.display.height).toBeCloseTo(360 * 25.4 / 96)
    expect(surface.pixels).toEqual({width: 640, height: 360})
    expect(surface.transform.scale).toEqual({x: 1, y: 1, z: 1})
    expect(surface.transform.position).toEqual({x: 0, y: 0, z: 0})
    expectDisplayFits(shell, {x: 12, y: 18, width: 640, height: 360})
    const renderer = createDocumentRenderer({
      document: shell.document,
      root: shell.display,
      viewport: surface.viewport,
      styleSheets: ["display { --widget-box-outline: #333333; }"],
    })
    const frame = renderer.flush()
    expect(frame.boxByNode.get(shell.display)?.width).toBeCloseTo(surface.viewport.width)
    expect(frame.boxByNode.get(shell.display)?.contentWidth).toBeCloseTo(surface.viewport.width - 2)
    expect(frame.displayList.some(item => item.kind === "rect" && item.node === shell.display)).toBe(true)
    renderer.dispose()
    const display = shell.display
    state.emitFrame(shell.hud, shell.workbench.elements.previewHost, {
      contentX: 180, contentY: 40, contentWidth: 480, contentHeight: 280,
    })
    expect(shell.display === display).toBe(true)
    const resized = readDisplayStyle(shell.document, display)
    expect(resized.viewport).toEqual({width: 480, height: 280})
    expect(resized.transform).toEqual(surface.transform)
    expect(resized.dpi.x).toBeCloseTo(96)
    expect(resized.dpi.y).toBeCloseTo(96)
    expectDisplayFits(shell, {x: 180, y: 40, width: 480, height: 280})
    const before = shell.presentedFrameSequence
    expect(shell.presentFrame()).toBeGreaterThan(before)
    expect(await shell.captureLastPresentedFramePng()).toBe(state.capture)
    unsubscribe()
    shell.dispose()
  })

  test("HUD and window resize recompute Display geometry and resolution while preserving content and focus", async () => {
    const state = createFakeRootState()
    const shell = await createShell(state)
    const button = shell.document.createElement("button")
    shell.mountPreview("Adaptive display", button)
    button.focus()
    shell.display.scrollTop = 12
    const projection = shell.projectionFor(button)
    for (const {bounds, viewport} of [
      {bounds: {x: 80, y: 20, width: 800, height: 180}, viewport: {width: 1024, height: 768}},
      {bounds: {x: 350, y: 30, width: 240, height: 650}, viewport: {width: 800, height: 900}},
      {bounds: {x: 600, y: 400, width: 20, height: 200}, viewport: {width: 1200, height: 700}},
      {bounds: {x: 250.25, y: 30.5, width: 899.75, height: 739.5}, viewport: {width: 1600, height: 800}},
    ]) {
      state.emitFrame(shell.hud, shell.workbench.elements.previewHost, {
        contentX: bounds.x, contentY: bounds.y, contentWidth: bounds.width, contentHeight: bounds.height,
      }, viewport)
      expectDisplayFits(shell, bounds, viewport)
      const surface = readDisplayStyle(shell.document, shell.display)
      expect(surface.viewport).toEqual({width: Math.round(bounds.width), height: Math.round(bounds.height)})
      expect(shell.display.width).toBeCloseTo(bounds.width * 25.4 / 96)
      expect(shell.display.height).toBeCloseTo(bounds.height * 25.4 / 96)
      expect(surface.transform.scale).toEqual({x: 1, y: 1, z: 1})
      expect(surface.transform.position).toEqual({x: 0, y: 0, z: 0})
      expect(shell.document.activeElement).toBe(button)
      expect(shell.display.scrollTop).toBe(12)
      expect(button.parentElement).toBe(shell.display)
      expect(shell.projectionFor(button)).toBe(projection)
      let mutations = 0
      const unsubscribe = shell.document.subscribeMutations(() => { mutations++ })
      state.emitFrame(shell.hud, shell.workbench.elements.previewHost, {
        contentX: bounds.x, contentY: bounds.y, contentWidth: bounds.width, contentHeight: bounds.height,
      }, viewport)
      expect(mutations).toBe(0)
      unsubscribe()
    }
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
    state.emitFrame(shell.hud, shell.workbench.elements.previewHost, {
      contentX: 80, contentY: 40, contentWidth: 500, contentHeight: 600,
    })
    expect(viewPointValues(shell.viewPoint)).toMatchObject({x: 10, y: -20, z: 30})
    preview.dispose()
    expect(viewPointValues(shell.viewPoint)).toEqual(restored)
    shell.mountPreview("Display again", shell.document.createElement("button"))
    state.emitFrame(shell.hud, shell.workbench.elements.previewHost, {
      contentX: 80, contentY: 40, contentWidth: 500, contentHeight: 600,
    })
    expectDisplayFits(shell, {x: 80, y: 40, width: 500, height: 600})
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

  test("dispatches text through the exact active Root projection", async () => {
    const state = createFakeRootState()
    const shell = await createShell(state)
    const target = shell.document.createElement("div")
    target.setAttribute("contenteditable", "plaintext-only")
    shell.mountPreview("Text", target)
    state.pointerTarget = target
    shell.root.input.pointerDown({x: 1, y: 1})
    shell.dispatchNativeText(target, "replacement")
    expect(state.texts).toEqual([{owner: shell.display, target, text: "replacement"}])
    state.activeTarget = null
    expect(() => shell.dispatchNativeText(target, "wrong target")).toThrow("Root native proxy")
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
  options: PresentationFixtureOptions | null
  root: Root | null
  pointerTarget: Element | null
  activeOwner: DisplayElement | HUDElement | null
  activeTarget: Element | null
  keys: Array<Readonly<{
    owner: DisplayElement | HUDElement
    target: Element
    input: Readonly<{type: "keydown" | "keyup"; key: string}>
  }>>
  texts: Array<Readonly<{owner: DisplayElement | HUDElement; target: Element; text: string}>>
  spaceGestures: Array<Readonly<{
    kind: "orbit" | "pan"
    deltaX: number
    deltaY: number
  }>>
  capture: Blob
  renderError: Error | null
  emitFrame(
    owner: DisplayElement | HUDElement,
    node: Node,
    box: Readonly<{
      contentX: number
      contentY: number
      contentWidth: number
      contentHeight: number
    }>,
    viewport?: Readonly<{width: number; height: number}>,
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
    texts: [],
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
    createRoot: fakeRootFactory(state),
    ...(options.authorStyleSheetSources === undefined
      ? {}
      : {authorStyleSheetSources: options.authorStyleSheetSources}),
  })
}

function fakeRootFactory(state: FakeRootState): ExternalStorybookRootFactory {
  return presentationRootFixture(async options => {
    state.creations += 1
    state.options = options
    const document = createDocument({elementFactories: createSpaceElementFactories()})
    const clipboard = createDocumentClipboardController(document)
    const html = document.createElement("html")
    const body = document.createElement("body")
    html.append(body)
    document.append(html)
    const appRoot = createRoot(body)
    appRoot.render(options.app)
    appRoot.flush()
    const space = body.querySelector("space") as SpaceElement
    const viewPoint = space.querySelector("viewpoint") as ViewPointElement
    const projections = new Map<DisplayElement | HUDElement, RootDocumentProjection>()
    const frames = new Map<DisplayElement | HUDElement, RenderFrame>()
    const frameListeners = new Map<DisplayElement | HUDElement, Set<(frame: RenderFrame) => void>>()
    const presented = new Set<(sequence: number) => void>()
    let sequence = 0
    let disposed = false

    const documentProjection = (
      owner: DisplayElement | HUDElement,
    ): RootDocumentProjection => {
      let projection = projections.get(owner)
      if (projection !== undefined) return projection
      projection = Object.freeze({
        kind: owner instanceof DisplayElement ? "display" as const : "hud" as const,
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
      owner: SpaceElement | DisplayElement | HUDElement,
    ): RootProjection => owner instanceof SpaceElement
      ? spaceProjection
      : documentProjection(owner)
    const root = Object.freeze({
      input: {
        pointerDown() {
          state.activeTarget = state.pointerTarget
          state.activeOwner = state.pointerTarget?.parentElement as DisplayElement | HUDElement
        },
        pointerMove() {},
        pointerUp() {},
        pointerCancel() {},
        wheel() {},
      },
      canvas: options.canvas,
      clipboard,
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
      dispatchKey(owner: DisplayElement | HUDElement, target: Element, input: any) {
        if (state.activeOwner !== owner || state.activeTarget !== target) {
          throw new Error("Semantic key target does not own the Root native proxy")
        }
        state.keys.push({owner, target, input})
        return true
      },
      dispatchText(owner: DisplayElement | HUDElement, target: Element, text: string) {
        if (state.activeOwner !== owner || state.activeTarget !== target) {
          throw new Error("Semantic text target does not own the Root native proxy")
        }
        state.texts.push({owner, target, text})
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
        clipboard.dispose()
      },
    }) as unknown as Root
    state.root = root
    state.emitFrame = (owner, node, box, viewport = {width: 1024, height: 768}) => {
      const renderBox = {
        node,
        x: box.contentX,
        y: box.contentY,
        width: box.contentWidth,
        height: box.contentHeight,
        ...box,
      } as RenderBox
      const frame = {...fakeFrame(document, owner, new Map([[node, renderBox]])), viewport}
      frames.set(owner, frame)
      for (const listener of frameListeners.get(owner) ?? []) listener(frame)
    }
    return root
  })
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

function expectDisplayFits(
  shell: Awaited<ReturnType<typeof createShell>>,
  bounds: Readonly<{x: number; y: number; width: number; height: number}>,
  viewport = {width: 1024, height: 768},
) {
  const viewPoint = shell.viewPoint
  const camera = new ViewPoint({
    position: {x: viewPoint.x, y: viewPoint.y, z: viewPoint.z},
    target: {x: viewPoint.targetX, y: viewPoint.targetY, z: viewPoint.targetZ},
    fov: viewPoint.fov, near: viewPoint.near, far: viewPoint.far,
    viewport: {left: 0, top: 0, ...viewport},
  })
  const width = shell.display.width
  const height = shell.display.height
  const corners = [new Vector3(-width / 2, 0, height / 2), new Vector3(width / 2, 0, -height / 2)]
    .map(point => point.applyMatrix4(camera.viewMatrix).applyMatrix4(camera.projectionMatrix))
  const left = (corners[0]!.x + 1) * viewport.width / 2
  const right = (corners[1]!.x + 1) * viewport.width / 2
  const top = (1 - corners[0]!.y) * viewport.height / 2
  const bottom = (1 - corners[1]!.y) * viewport.height / 2
  // Engine хранит матрицы в Float32; допустимая погрешность меньше 0,001 CSS px.
  expect(left).toBeGreaterThanOrEqual(bounds.x - 1e-3)
  expect(right).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-3)
  expect(top).toBeGreaterThanOrEqual(bounds.y - 1e-3)
  expect(bottom).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-3)
  expect((left + right) / 2).toBeCloseTo(bounds.x + bounds.width / 2, 3)
  expect((top + bottom) / 2).toBeCloseTo(bounds.y + bounds.height / 2, 3)
  expect(left).toBeCloseTo(bounds.x, 3)
  expect(right).toBeCloseTo(bounds.x + bounds.width, 3)
  expect(top).toBeCloseTo(bounds.y, 3)
  expect(bottom).toBeCloseTo(bounds.y + bounds.height, 3)
  expect((right - left) / (bottom - top)).toBeCloseTo(bounds.width / bounds.height, 4)
  const surface = readDisplayStyle(shell.document, shell.display)
  expect((right - left) / surface.viewport.width).toBeCloseTo(1, 2)
  expect((bottom - top) / surface.viewport.height).toBeCloseTo(1, 2)
  expect(Math.max((right - left) / bounds.width, (bottom - top) / bounds.height)).toBeCloseTo(1, 4)
  expect(-viewPoint.y).toBeLessThan(viewPoint.far)
}

function viewPointValues(viewPoint: ViewPointElement) {
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
