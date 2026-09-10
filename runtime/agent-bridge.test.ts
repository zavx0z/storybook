import {describe, expect, test} from "bun:test"
import {
  Event,
  HTMLElement as SemanticHTMLElement,
  createDocument,
  type Document as SemanticDocument,
  type Element as SemanticElement,
} from "@zavx0z/dom"
import type {
  RootPointerInput,
  RootWheelInput,
} from "@zavx0z/browser/integration"
import {createDocumentRenderer} from "@zavx0z/renderer"
import {createDocumentInteractionController, hitTestProjection} from "@renderer/html"
import {createSpaceElementFactories} from "@zavx0z/space"
import {HUDElement} from "../../webxr-space/dom/hud/index.ts"
import {SpaceElement} from "@zavx0z/dom/space"
import type {ExternalStorybookPackageTabModel} from "./model.ts"
import {
  createStorybookAgentBridge,
  STORYBOOK_AGENT_BRIDGE_GLOBAL,
  STORYBOOK_AGENT_BRIDGE_PROTOCOL,
  type StorybookAgentBridge,
  type StorybookAgentBridgeRequest,
} from "./agent-bridge.ts"
import type {
  ExternalStorybookNativeKey,
  ExternalStorybookShell,
} from "./shell.ts"

describe("external Storybook agent bridge inspection", () => {
  test("читает актуальную видимость native страницы без нового кадра или ввода", async () => {
    let focused = true
    const nativePage = {
      visibilityState: "visible" as DocumentVisibilityState,
      hasFocus: () => focused,
    }
    const fixture = createFixture({nativePage})
    try {
      const before = fixture.shell.presentedFrameSequence
      const first = await fixture.bridge.call("inspect", {include: ["state"]}) as AgentInspection
      expect(first.nativePage).toEqual({visibilityState: "visible", hasFocus: true})
      nativePage.visibilityState = "hidden"
      focused = false
      const second = await fixture.bridge.call("inspect", {include: ["state"]}) as AgentInspection
      expect(second.nativePage).toEqual({visibilityState: "hidden", hasFocus: false})
      expect(first.nativePage).toEqual({visibilityState: "visible", hasFocus: true})
      expect(first.frameSequence).toBe(before)
      expect(second.frameSequence).toBe(before)
      expect(second.revision).toBe(first.revision)
      expect(fixture.shell.presentedFrameSequence).toBe(before)
      expect(fixture.shell.canvas.hidden).toBeFalse()
      expect(fixture.calls.pointerDowns).toHaveLength(0)
      expect(fixture.calls.nativeKeys).toHaveLength(0)
    } finally {fixture.dispose()}
  })

  test("отмечает недоступные native page сведения как null", async () => {
    const fixture = createFixture()
    try {
      const inspected = await fixture.bridge.call("inspect", {include: ["state"]}) as AgentInspection
      expect(inspected.nativePage).toEqual({visibilityState: null, hasFocus: null})
      expect(inspected.frameSequence).toBe(0)
    } finally {fixture.dispose()}
  })

  test("rejects an interaction when the caller expected another package", async () => {
    const fixture = createFixture()
    try {
      await expect(fixture.bridge.call("interact", {expectedPackageId: "@other/package", action: "click", target: {role: "button", name: "Run"}}))
        .rejects.toThrow("another package")
    } finally {
      fixture.dispose()
    }
  })

  test("keeps stable node identities across compact, default and paginated projections", async () => {
    const fixture = createFixture()
    try {
      const state = await fixture.bridge.invoke(request("state")) as AgentInspection
      expect(state.canvas).toEqual({
        id: "external-storybook-canvas",
        width: 640,
        height: 480,
        hidden: false,
      })
      expect("canvases" in state).toBeFalse()

      const compact = await fixture.bridge.invoke(request("inspect", {
        include: ["state"],
      })) as AgentInspection
      expect(compact).toMatchObject({
        protocol: STORYBOOK_AGENT_BRIDGE_PROTOCOL,
        packageId: "@fixture/storybook",
        revision: "revision-1",
        graphDigest: "graph-1",
        route: "/controls/default",
        ready: true,
        presented: false,
        frameSequence: 0,
      })
      expect(compact.semantic).toBeUndefined()
      expect(compact.diagnostics).toBeUndefined()
      expect(compact.canvas).toBeUndefined()

      const defaultInspection = await fixture.bridge.call("inspect") as AgentInspection
      expect(defaultInspection.semantic?.nodes.length).toBeGreaterThan(0)
      expect(defaultInspection.semantic?.total).toBeGreaterThan(0)
      expect(defaultInspection.diagnostics).toEqual([])
      expect(defaultInspection.canvas).toEqual({
        id: "external-storybook-canvas",
        width: 640,
        height: 480,
        hidden: false,
      })
      expect(defaultInspection.semantic?.nodes.every((node) => !("bounds" in node))).toBeTrue()
      expect(defaultInspection.semantic?.nodes.every((node) => !("display" in node))).toBeTrue()

      const firstPage = await fixture.bridge.invoke(request("inspect", {
        include: ["semantic", "layout", "display"],
        maxDepth: 12,
        limit: 3,
      })) as AgentInspection
      expect(firstPage.semantic?.nodes).toHaveLength(3)
      expect(firstPage.semantic?.nextCursor).toBe("offset:3")
      expect(firstPage.semantic?.nodes.every((node) => "bounds" in node)).toBeTrue()
      expect(firstPage.semantic?.nodes.every((node) => "display" in node && "hit" in node)).toBeTrue()
      expect(firstPage.diagnostics).toBeUndefined()
      expect(firstPage.canvas).toBeUndefined()

      const secondPage = await fixture.bridge.invoke(request("inspect", {
        include: ["semantic", "layout", "display"],
        maxDepth: 12,
        limit: 3,
        cursor: firstPage.semantic?.nextCursor ?? undefined,
      })) as AgentInspection
      expect(secondPage.semantic?.nodes).toHaveLength(3)
      expect(new Set([
        ...(firstPage.semantic?.nodes.map(({nodeId}) => nodeId) ?? []),
        ...(secondPage.semantic?.nodes.map(({nodeId}) => nodeId) ?? []),
      ]).size).toBe(6)

      const repeated = await fixture.bridge.invoke(request("inspect", {
        include: ["semantic"],
        maxDepth: 12,
        limit: 200,
      })) as AgentInspection
      const stable = new Map(repeated.semantic?.nodes
        .filter((node) => node.role !== null)
        .map((node) => [node.text, node.nodeId]))
      expect(stable.get("Run exact")).toBe(fixture.nodeIds(defaultInspection).run)
      expect(stable.get("Drop here")).toBe(fixture.nodeIds(defaultInspection).destination)
      expect(repeated.semantic?.nodes.every((node) => !("bounds" in node))).toBeTrue()
      expect(repeated.semantic?.nodes.every((node) => !("display" in node))).toBeTrue()

      const layoutOnly = await fixture.bridge.invoke(request("inspect", {
        include: ["layout"],
        maxDepth: 12,
        limit: 200,
      })) as AgentInspection
      expect(layoutOnly.semantic?.nodes.some((node) => node.bounds !== null)).toBeTrue()
      expect(layoutOnly.semantic?.nodes.every((node) => !("display" in node))).toBeTrue()
    } finally {
      fixture.dispose()
    }
  })
})

describe("external Storybook agent bridge interaction", () => {
  test.each([[1, false], [0.43, false], [0.43, true]] as const)("попадает в кнопку при scale %s, box fallback %s и единственной проекции", async (scale, omitRunHit) => {
    const fixture = createFixture({realPointer: true, omitRunHit, projectionOffset: {x: 120, y: 80}})
    try {
      fixture.preview.setAttribute("style", `display:block; width:300px; height:140px; transform:translate(30px, 20px) scale(${scale}); transform-origin:top left`)
      let clicks = 0
      fixture.run.addEventListener("click", () => {clicks += 1})
      fixture.shell.presentFrame()
      const frame = fixture.shell.root.getProjection(fixture.shell.hud).readFrame()!
      const hit = frame.hits.get(fixture.run) ?? frame.boxByNode.get(fixture.run)!
      const expected = {
        x: (hit.x + hit.width / 2) * hit.transform.scaleX + hit.transform.translateX,
        y: (hit.y + hit.height / 2) * hit.transform.scaleY + hit.transform.translateY,
      }
      const inspected = await fixture.bridge.call("inspect") as AgentInspection
      for (const target of [{role: "button", name: "Run exact"}, {nodeId: fixture.nodeIds(inspected).run}]) {
        await fixture.bridge.call("interact", {action: "click", target})
        const actual = fixture.calls.pointerDowns.at(-1)!
        expect(actual.x).toBeCloseTo(expected.x + 120)
        expect(actual.y).toBeCloseTo(expected.y + 80)
        if (!omitRunHit) expect(hitTestProjection(frame, actual.x - 120, actual.y - 80)?.node).toBe(fixture.run)
      }
      expect(clicks).toBe(2)
    } finally {fixture.dispose()}
  })

  test("отклоняет нечисловую клиентскую точку до доставки pointer", async () => {
    const fixture = createFixture({realPointer: true, projectionOffset: {x: Number.POSITIVE_INFINITY, y: 0}})
    try {
      await expect(fixture.bridge.call("interact", {action: "click", target: {role: "button", name: "Run exact"}}))
        .rejects.toThrow("non-finite client bounds")
      expect(fixture.calls.pointerDowns).toHaveLength(0)
      expect(fixture.calls.pointerUps).toHaveLength(0)
    } finally {fixture.dispose()}
  })

  test("resolves exact role and name and performs the complete bounded action vocabulary", async () => {
    const fixture = createFixture()
    try {
      const inspection = await fixture.bridge.invoke(request("inspect", {
        include: ["semantic", "layout", "display"],
        maxDepth: 12,
        limit: 200,
      })) as AgentInspection
      const ids = fixture.nodeIds(inspection)
      const semanticKeyEvents: Event[] = []
      const inputEvents: Event[] = []
      fixture.run.addEventListener("keydown", (event) => semanticKeyEvents.push(event))
      fixture.run.addEventListener("keyup", (event) => semanticKeyEvents.push(event))
      fixture.input.addEventListener("input", (event) => inputEvents.push(event))

      let lastSequence = fixture.shell.presentedFrameSequence
      const interact = async (value: Omit<StorybookAgentBridgeRequest, "protocol" | "operation">) => {
        const result = await fixture.bridge.invoke(request("interact", value)) as AgentInteractionResult
        expect(result.ok).toBeTrue()
        expect(result.frameSequence).toBeGreaterThan(lastSequence)
        expect(result.state.frameSequence).toBe(result.frameSequence)
        lastSequence = result.frameSequence
        return result
      }

      await interact({action: "hover", target: {role: "button", name: "Run exact"}})
      expect(fixture.calls.pointerMoves.at(-1)).toMatchObject({buttons: 0, pointerType: "mouse"})

      await interact({action: "focus", target: {nodeId: ids.run}})
      expect(fixture.document.activeElement).toBe(fixture.run)

      await interact({action: "click", target: {nodeId: ids.run}})
      expect(fixture.calls.pointerDowns.at(-1)).toMatchObject({buttons: 1})
      expect(fixture.calls.pointerUps.at(-1)).toMatchObject({buttons: 0})

      await interact({action: "pointerDown", target: {nodeId: ids.run}})
      await interact({action: "pointerUp", target: {nodeId: ids.run}})
      expect(fixture.calls.pointerDowns).toHaveLength(2)
      expect(fixture.calls.pointerUps).toHaveLength(2)

      await interact({action: "drag", target: {nodeId: ids.run}, destination: {nodeId: ids.destination}})
      expect(fixture.calls.pointerDowns.at(-1)).toMatchObject({buttons: 1})
      expect(fixture.calls.pointerMoves.at(-1)?.x)
        .toBeGreaterThan(fixture.calls.pointerDowns.at(-1)?.x ?? Number.POSITIVE_INFINITY)
      expect(fixture.calls.pointerUps.at(-1)).toMatchObject({buttons: 0})
      expect(fixture.calls.pointerUps.at(-1)?.x).toBe(fixture.calls.pointerMoves.at(-1)?.x)

      await interact({action: "drag", target: {nodeId: ids.run}, value: {dx: 12, dy: 8}})
      expect(fixture.calls.pointerMoves.at(-1)?.x)
        .toBe((fixture.calls.pointerDowns.at(-1)?.x ?? 0) + 12)
      expect(fixture.calls.pointerMoves.at(-1)?.y)
        .toBe((fixture.calls.pointerDowns.at(-1)?.y ?? 0) + 8)

      await interact({
        action: "key",
        target: {nodeId: ids.run},
        value: {key: "Enter", modifiers: ["alt", "ctrl", "meta", "shift"]},
      })
      expect(fixture.calls.nativeKeys).toEqual([{
        target: fixture.run,
        input: {
          key: "Enter",
          altKey: true,
          ctrlKey: true,
          metaKey: true,
          shiftKey: true,
        },
      }])
      expect(semanticKeyEvents).toHaveLength(0)

      await interact({action: "type", target: {nodeId: ids.input}, value: {text: " typed"}})
      expect(fixture.calls.nativeTexts).toEqual([{target: fixture.input, text: " typed"}])
      expect(fixture.input.value).toBe("seed")
      expect(inputEvents).toHaveLength(0)

      await interact({action: "wheel", target: {nodeId: ids.destination}, value: {deltaY: -48}})
      expect(fixture.calls.wheels.at(-1)).toMatchObject({deltaY: -48})

      const scenario = await interact({action: "scenario", value: "variant:alternate"})
      expect(fixture.navigations).toEqual(["/controls/alternate"])
      expect(scenario.state.route).toBe("/controls/alternate")

      const checkbox = fixture.document.createElement("input")
      checkbox.setAttribute("type", "checkbox")
      checkbox.setAttribute("title", "Owner checkbox")
      checkbox.setAttribute("style", "display:block; width:18px; height:18px")
      fixture.preview.appendChild(checkbox)
      await interact({action: "click", target: {role: "checkbox", name: "Owner checkbox"}})

      const duplicate = fixture.document.createElement("button")
      duplicate.textContent = "Run exact"
      duplicate.setAttribute("style", "display:block; width:80px; height:24px")
      fixture.root.appendChild(duplicate)
      await expect(fixture.bridge.invoke(request("interact", {
        action: "hover",
        target: {role: "button", name: "Run exact"},
      }))).rejects.toThrow("Ambiguous Storybook semantic target: button Run exact")
      await expect(fixture.bridge.invoke(request("interact", {
        action: "hover",
        target: {role: "button", name: "Missing"},
      }))).rejects.toThrow("Unknown Storybook semantic target: button Missing")
    } finally {
      fixture.dispose()
    }
  })

  test("key focuses without pointer synthesis and preserves the exact existing selection", async () => {
    const fixture = createFixture()
    try {
      if (!(fixture.run instanceof SemanticHTMLElement)) throw new Error("Expected semantic HTMLElement")
      fixture.run.focus()
      const selection = fixture.document.getSelection()
      selection.setBaseAndExtent(fixture.run.firstChild!, 1, fixture.run.firstChild!, 5)
      const range = selection.getRangeAt(0)
      await fixture.bridge.invoke(request("interact", {
        action: "key", target: {role: "button", name: "Run exact"}, value: {key: "c", modifiers: ["meta"]},
      }))
      expect(fixture.calls.pointerDowns).toHaveLength(0)
      expect(fixture.calls.pointerUps).toHaveLength(0)
      expect(selection.getRangeAt(0)).toBe(range)
      expect(selection.toString()).toBe("un e")
    } finally {fixture.dispose()}
  })

  test("contenteditable type delegates to Browser without Storybook text mutation", async () => {
    const fixture = createFixture()
    const editor = fixture.document.createElement("div")
    editor.setAttribute("contenteditable", "plaintext-only")
    editor.setAttribute("role", "textbox")
    editor.setAttribute("aria-label", "Editable source")
    editor.textContent = "original"
    fixture.preview.append(editor)
    try {
      await fixture.bridge.invoke(request("interact", {
        action: "type", target: {role: "textbox", name: "Editable source"}, value: "typed",
      }))
      expect(fixture.document.activeElement).toBe(editor)
      expect(fixture.calls.nativeTexts).toEqual([{target: editor, text: "typed"}])
      expect(editor.textContent).toBe("original")
      expect(fixture.calls.pointerDowns).toHaveLength(0)
    } finally {fixture.dispose()}
  })
})

describe("external Storybook agent bridge capture", () => {
  test("returns exact presented workbench, preview, host canvas and semantic node clips", async () => {
    const fixture = createFixture()
    try {
      const inspection = await fixture.bridge.invoke(request("inspect", {
        include: ["semantic", "layout"],
        maxDepth: 12,
        limit: 200,
      })) as AgentInspection
      const ids = fixture.nodeIds(inspection)
      let lastSequence = fixture.shell.presentedFrameSequence
      const capture = async (area: "workbench" | "preview" | "canvas" | "node", nodeId?: string) => {
        const result = await fixture.bridge.invoke(request("capture", {
          area,
          ...(nodeId === undefined ? {} : {nodeId}),
        })) as AgentCaptureResult
        expect(result.frameSequence).toBeGreaterThan(lastSequence)
        lastSequence = result.frameSequence
        expect(result.clip.scale).toBe(1)
        return result.clip
      }

      expect(await capture("workbench")).toMatchObject({x: 0, y: 0, width: 640, height: 480})
      expect(await capture("preview")).toMatchObject({width: 300, height: 140})
      expect(await capture("canvas")).toEqual({x: 0, y: 0, width: 640, height: 480, scale: 1})
      const nodeClip = await capture("node", ids.run)
      const run = inspection.semantic?.nodes.find(({nodeId}) => nodeId === ids.run)
      expect(nodeClip).toMatchObject({
        x: run?.bounds?.x,
        y: run?.bounds?.y,
        width: run?.bounds?.width,
        height: run?.bounds?.height,
      })
    } finally {
      fixture.dispose()
    }
  })
})

type AgentNode = Readonly<{
  nodeId: string
  tag: string | null
  role: string | null
  name: string
  text: string
  bounds?: Readonly<{x: number; y: number; width: number; height: number}> | null
  display?: readonly unknown[]
  hit?: unknown
}>

type AgentInspection = Readonly<{
  nativePage: Readonly<{visibilityState: DocumentVisibilityState | null; hasFocus: boolean | null}>
  protocol: string
  packageId: string
  revision: string
  graphDigest: string
  route: string
  ready: boolean
  presented: boolean
  frameSequence: number
  diagnostics?: readonly string[]
  canvas?: Readonly<{id: string; width: number; height: number; hidden: boolean}>
  semantic?: Readonly<{
    root: string
    nodes: readonly AgentNode[]
    nextCursor: string | null
    total: number
  }>
}>

type AgentInteractionResult = Readonly<{
  ok: true
  action: string
  frameSequence: number
  state: Readonly<{route: string; frameSequence: number}>
}>

type AgentCaptureResult = Readonly<{
  frameSequence: number
  clip: Readonly<{x: number; y: number; width: number; height: number; scale: number}>
}>

type Fixture = Readonly<{
  bridge: StorybookAgentBridge
  shell: ExternalStorybookShell
  document: SemanticDocument
  root: SemanticElement
  preview: SemanticElement
  run: SemanticElement
  destination: SemanticElement
  input: InstanceType<typeof import("@zavx0z/dom").HTMLInputElement>
  calls: InteractionCalls
  navigations: string[]
  nodeIds(inspection: AgentInspection): Readonly<{run: string; destination: string; input: string}>
  dispose(): void
}>

type InteractionCalls = Readonly<{
  pointerMoves: RootPointerInput[]
  pointerDowns: RootPointerInput[]
  pointerUps: RootPointerInput[]
  wheels: RootWheelInput[]
  nativeKeys: Array<Readonly<{
    target: SemanticElement
    input: ExternalStorybookNativeKey
  }>>
  nativeTexts: Array<Readonly<{target: SemanticElement; text: string}>>
}>

function createFixture(options: Readonly<{
  nativePage?: Readonly<{visibilityState: DocumentVisibilityState; hasFocus(): boolean}>
  realPointer?: boolean
  omitRunHit?: boolean
  projectionOffset?: Readonly<{x: number; y: number}>
}> = {}): Fixture {
  const document = createDocument({elementFactories: createSpaceElementFactories()})
  const space = document.createElement("space") as SpaceElement
  const viewPoint = document.createElement("viewpoint")
  const hud = document.createElement("hud") as HUDElement
  hud.id = "external-storybook-workbench"
  const root = document.createElement("div")
  root.setAttribute("style", "display:block; width:640px; height:480px; background:#202124")
  const preview = document.createElement("main")
  preview.setAttribute("aria-label", "Preview")
  preview.setAttribute("style", "display:block; width:300px; height:140px; background:#30343c")
  const run = document.createElement("button")
  run.textContent = "Run exact"
  run.setAttribute("style", "display:block; width:100px; height:28px; padding:0; background:#31566a")
  const destination = document.createElement("button")
  destination.textContent = "Drop here"
  destination.setAttribute("style", "display:block; margin-left:200px; width:100px; height:28px; padding:0")
  const input = document.createElement("input")
  input.setAttribute("aria-label", "Owner input")
  input.setAttribute("style", "display:block; width:180px; height:28px")
  input.value = "seed"
  const nested = document.createElement("section")
  const nestedLabel = document.createElement("span")
  nestedLabel.textContent = "Nested semantic detail"
  nested.appendChild(nestedLabel)
  preview.append(run, destination, input, nested)
  root.appendChild(preview)
  document.transaction(() => {
    hud.append(root)
    space.append(viewPoint, hud)
    document.append(space)
  })

  const renderer = createDocumentRenderer({
    document,
    root: hud,
    viewport: {width: 640, height: 480},
  })
  const calls: InteractionCalls = {
    pointerMoves: [],
    pointerDowns: [],
    pointerUps: [],
    wheels: [],
    nativeKeys: [],
    nativeTexts: [],
  }
  const interaction = createDocumentInteractionController({document, hitTest: hitTestProjection})
  const offset = options.projectionOffset ?? {x: 0, y: 0}
  const localPointer = (input: RootPointerInput) => ({
    ...input,
    clientX: input.x - offset.x,
    clientY: input.y - offset.y,
  })
  const hudProjection = Object.freeze({
    kind: "hud" as const,
    owner: hud,
    readFrame() {
      const frame = renderer.flush()
      if (!options.omitRunHit) return frame
      const hits = new Map(frame.hits)
      hits.delete(run)
      return {...frame, hits}
    },
    projectPoint: (point: {x: number; y: number}) => ({x: point.x + offset.x, y: point.y + offset.y}),
    subscribeFrames: () => () => {},
    pointerMove(inputValue: RootPointerInput) {
      calls.pointerMoves.push(inputValue)
      if (options.realPointer) return interaction.pointerMove(renderer.flush(), localPointer(inputValue))
      return run
    },
    pointerDown(inputValue: RootPointerInput) {
      calls.pointerDowns.push(inputValue)
      if (options.realPointer) return interaction.pointerDown(renderer.flush(), localPointer(inputValue))
      return run
    },
    pointerUp(inputValue: RootPointerInput) {
      calls.pointerUps.push(inputValue)
      if (options.realPointer) return interaction.pointerUp(renderer.flush(), localPointer(inputValue))
      return run
    },
    wheel(inputValue: RootWheelInput) {
      calls.wheels.push(inputValue)
      return destination
    },
  })
  const spaceProjection = Object.freeze({
    kind: "space" as const,
    owner: space,
    orbit() {},
    pan() {},
    zoom() {},
  })
  const externalCanvas = canvas("external-storybook-canvas", 640, 480, {left: 0, top: 0})
  const browserDocument = {
    get visibilityState() { return options.nativePage?.visibilityState },
    hasFocus: options.nativePage?.hasFocus,
    defaultView: {name: "storybook-view"},
    documentElement: {
      dataset: {
        externalStorybookPackage: "ready",
        externalStorybookPackageId: "@fixture/storybook",
        externalStorybookRoute: "/controls/default",
        externalStorybookRevision: "revision-1",
      },
    },
    querySelectorAll() {
      throw new Error("Agent bridge must not scan native canvases")
    },
  } as unknown as globalThis.Document
  let route = "/controls/default"
  let frameSequence = 0
  const model = {
    packageNode: {} as never,
    selectedNode: {} as never,
    catalogItems: Object.freeze([]),
    catalogActiveId: "category:controls",
    secondaryItems: Object.freeze([]),
    secondaryActiveId: "subject:run",
    variants: Object.freeze([
      Object.freeze({
        id: "variant:alternate",
        label: "Alternate",
        route: "/controls/alternate",
        urlPath: "/package/fixture/controls/alternate",
        title: "Alternate",
        searchText: "alternate",
        group: null,
      }),
    ]),
    variantActiveId: null,
  } satisfies ExternalStorybookPackageTabModel
  const workbench = {
    document,
    element: root,
    elements: {previewHost: preview},
  }
  const shell = Object.freeze({
    root: {input: hudProjection, getProjection: () => hudProjection},
    document,
    browserDocument,
    canvas: externalCanvas,
    space,
    viewPoint,
    hud,
    workbench,
    projectionFor(node: import("@zavx0z/dom").Node) {
      if (node === hud || hud.contains(node)) return hudProjection
      if (node === space || space.contains(node)) return spaceProjection
      throw new Error("Fixture node is outside Root")
    },
    applySpacePreviewGesture() {
      return false
    },
    dispatchNativeKey(target: SemanticElement, input: ExternalStorybookNativeKey) {
      calls.nativeKeys.push({target, input})
    },
    dispatchNativeText(target: SemanticElement, text: string) {
      calls.nativeTexts.push({target, text})
    },
    get presentedFrameSequence() {
      return frameSequence
    },
    presentFrame() {
      renderer.render()
      frameSequence += 1
      return frameSequence
    },
  }) as unknown as ExternalStorybookShell
  const navigations: string[] = []
  const bridge = createStorybookAgentBridge({
    packageId: "@fixture/storybook",
    revision: "revision-1",
    graphDigest: "graph-1",
    shell,
    getRoute: () => route,
    getModel: () => model,
    async navigate(nextRoute) {
      navigations.push(nextRoute)
      route = nextRoute
    },
  })

  return Object.freeze({
    bridge,
    shell,
    document,
    root,
    preview,
    run,
    destination,
    input,
    calls,
    navigations,
    nodeIds(inspection) {
      const runNode = inspection.semantic?.nodes.find((node) => node.text === "Run exact" && node.role === "button")
      const destinationNode = inspection.semantic?.nodes.find((node) => node.text === "Drop here" && node.role === "button")
      const inputNode = inspection.semantic?.nodes.find((node) => node.name === "Owner input" && node.role === "textbox")
      if (runNode === undefined || destinationNode === undefined || inputNode === undefined) {
        throw new Error("Fixture semantic controls were not inspected")
      }
      return Object.freeze({
        run: runNode.nodeId,
        destination: destinationNode.nodeId,
        input: inputNode.nodeId,
      })
    },
    dispose() {
      bridge.dispose()
      interaction.dispose()
      renderer.dispose()
      expect((globalThis as typeof globalThis & Record<string, unknown>)[STORYBOOK_AGENT_BRIDGE_GLOBAL]).toBeUndefined()
    },
  })
}

function request(
  operation: StorybookAgentBridgeRequest["operation"],
  values: Record<string, unknown> = {},
): StorybookAgentBridgeRequest {
  return {
    ...values,
    protocol: STORYBOOK_AGENT_BRIDGE_PROTOCOL,
    operation,
  } as StorybookAgentBridgeRequest
}

function canvas(
  id: string,
  width: number,
  height: number,
  position: Readonly<{left: number; top: number}>,
): HTMLCanvasElement {
  return {
    id,
    width,
    height,
    hidden: false,
    getBoundingClientRect: () => ({
      ...position,
      x: position.left,
      y: position.top,
      right: position.left + width,
      bottom: position.top + height,
      width,
      height,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLCanvasElement
}
