import {describe, expect, test} from "bun:test"
import type {
  CreateExperienceOptions,
  Experience,
  ExperienceDocumentProjection,
  ExperienceProjection,
} from "@zavx0z/browser"
import {
  createDocument,
  type Element,
  type Node,
} from "@zavx0z/dom"
import type {RenderBox, RenderFrame} from "@zavx0z/renderer"
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
  type ExternalStorybookExperienceFactory,
} from "./shell.ts"

describe("external Storybook shared Browser Experience", () => {
  test("creates one semantic Space/ViewPoint/Display/HUD and mounts the Workbench in HUD", async () => {
    const state = createFakeExperienceState()
    const shell = await createShell(state)

    expect(state.creations).toBe(1)
    expect(shell.document).toBe(shell.experience.document)
    expect(shell.space).toBe(shell.experience.space)
    expect(shell.viewPoint).toBe(shell.experience.viewPoint)
    expect(shell.document.documentElement).toBe(shell.space)
    expect(shell.viewPoint.parentElement).toBe(shell.space)
    expect(viewPointValues(shell.viewPoint)).toMatchObject({
      x: 0,
      y: 0,
      z: 1_000,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      upX: 0,
      upY: 1,
      upZ: 0,
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
    expect(shell.display.firstChild).toBe(displayNode)
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

  test("passes exact linked author styles to createExperience", async () => {
    const state = createFakeExperienceState()
    const link = {} as HTMLLinkElement
    const shell = await createShell(state, {
      authorStyleSheetSources: [{id: "@zavx0z/ui/themes/theme.css", link}],
    })

    expect(state.options?.linkedAuthorStyleSheets).toEqual([{
      id: "@zavx0z/ui/themes/theme.css",
      link,
    }])
    expect(state.options?.styleSheets).toEqual([])
    expect(state.options?.cameraGestures).toBeFalse()
    shell.dispose()
  })

  test("uses Experience frames for bounds, acknowledgement and capture", async () => {
    const state = createFakeExperienceState()
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
    const before = shell.presentedFrameSequence
    expect(shell.presentFrame()).toBeGreaterThan(before)
    expect(await shell.captureLastPresentedFramePng()).toBe(state.capture)
    unsubscribe()
    shell.dispose()
  })

  test("routes Space camera gestures through the semantic ViewPoint and restores its preset", async () => {
    const state = createFakeExperienceState()
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
    expect(shell.applySpacePreviewGesture(node, {
      kind: "orbit",
      deltaX: 4,
      deltaY: -2,
    })).toBeTrue()
    expect(state.spaceGestures).toEqual([{kind: "orbit", deltaX: 4, deltaY: -2}])
    preview.dispose()
    expect(viewPointValues(shell.viewPoint)).toEqual(restored)
    shell.dispose()
  })

  test("dispatches keys only through the exact active Display or HUD projection", async () => {
    const state = createFakeExperienceState()
    const shell = await createShell(state)
    const target = shell.document.createElement("button")
    shell.mountPreview("Key", target)
    state.pointerTarget = target
    const projection = shell.projectionFor(target)
    if (projection.kind === "space") throw new Error("Expected a document projection")
    projection.pointerDown({x: 1, y: 1})

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

  test("keeps landing and package shells as separate Experiences", async () => {
    const landingState = createFakeExperienceState()
    const packageState = createFakeExperienceState()
    const landing = await createShell(landingState)
    const packageShell = await createShell(packageState)

    expect(landing.experience).not.toBe(packageShell.experience)
    expect(landing.document).not.toBe(packageShell.document)
    expect(landing.space).not.toBe(packageShell.space)
    landing.dispose()
    packageShell.dispose()
  })

  test("releases the Experience when its first presented frame fails", async () => {
    const state = createFakeExperienceState()
    state.renderError = new Error("first frame failed")

    await expect(createShell(state)).rejects.toThrow("first frame failed")
    expect(state.experience?.disposed).toBeTrue()
  })
})

type FakeExperienceState = {
  creations: number
  options: CreateExperienceOptions | null
  experience: Experience | null
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

function createFakeExperienceState(): FakeExperienceState {
  return {
    creations: 0,
    options: null,
    experience: null,
    pointerTarget: null,
    activeOwner: null,
    activeTarget: null,
    keys: [],
    spaceGestures: [],
    capture: new Blob(["capture"], {type: "image/png"}),
    renderError: null,
    emitFrame() {
      throw new Error("Fake Experience is not created")
    },
  }
}

async function createShell(
  state: FakeExperienceState,
  options: Readonly<{
    authorStyleSheetSources?: CreateExperienceOptions["linkedAuthorStyleSheets"]
  }> = {},
) {
  return createExternalStorybookShell({
    title: "Fixture Storybook",
    browserDocument: {} as globalThis.Document,
    canvas: {width: 1024, height: 768} as HTMLCanvasElement,
    loadFont: async () => ({}) as never,
    createExperience: fakeExperienceFactory(state),
    ...(options.authorStyleSheetSources === undefined
      ? {}
      : {authorStyleSheetSources: options.authorStyleSheetSources}),
  })
}

function fakeExperienceFactory(state: FakeExperienceState): ExternalStorybookExperienceFactory {
  return async options => {
    state.creations += 1
    state.options = options
    const document = createDocument({elementFactories: createSpaceElementFactories()})
    const space = document.createElement("xr-space") as XRSpaceElement
    const viewPoint = document.createElement("xr-view-point") as XRViewPointElement
    document.transaction(() => {
      space.append(viewPoint)
      document.append(space)
    })
    const projections = new Map<XRDisplayElement | XRHUDElement, ExperienceDocumentProjection>()
    const frames = new Map<XRDisplayElement | XRHUDElement, RenderFrame>()
    const frameListeners = new Map<XRDisplayElement | XRHUDElement, Set<(frame: RenderFrame) => void>>()
    const presented = new Set<(sequence: number) => void>()
    let sequence = 0
    let disposed = false

    const documentProjection = (
      owner: XRDisplayElement | XRHUDElement,
    ): ExperienceDocumentProjection => {
      let projection = projections.get(owner)
      if (projection !== undefined) return projection
      projection = Object.freeze({
        kind: owner instanceof XRDisplayElement ? "display" as const : "hud" as const,
        owner,
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
    ): ExperienceProjection => owner instanceof XRSpaceElement
      ? spaceProjection
      : documentProjection(owner)
    const experience = Object.freeze({
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
          throw new Error("Semantic key target does not own the Experience native proxy")
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
      requestFrame() {},
      resize() {},
      captureLastPresentedFramePng: async () => state.capture,
      dispose() { disposed = true },
    }) as unknown as Experience
    state.experience = experience
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
    return experience
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
    upX: viewPoint.upX,
    upY: viewPoint.upY,
    upZ: viewPoint.upZ,
    fov: viewPoint.fov,
    near: viewPoint.near,
    far: viewPoint.far,
  }
}
