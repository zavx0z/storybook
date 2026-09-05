import {describe, expect, test} from "bun:test"
import {
  Event,
  createDocument,
  type Document as SemanticDocument,
  type Element as SemanticElement,
} from "@zavx0z/dom"
import type {
  RootPointerInput,
  RootWheelInput,
} from "@zavx0z/browser"
import {createDocumentRenderer} from "@zavx0z/renderer"
import {
  createSpaceElementFactories,
  XRHUDElement,
  XRSpaceElement,
} from "@zavx0z/space"
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
      expect(fixture.input.value).toBe("seed typed")
      expect(inputEvents).toHaveLength(1)
      expect(inputEvents[0]).toMatchObject({type: "input", bubbles: true, composed: true})

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
}>

function createFixture(): Fixture {
  const document = createDocument({elementFactories: createSpaceElementFactories()})
  const space = document.createElement("xr-space") as XRSpaceElement
  const viewPoint = document.createElement("xr-view-point")
  const hud = document.createElement("xr-hud") as XRHUDElement
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
  }
  const hudProjection = Object.freeze({
    kind: "hud" as const,
    owner: hud,
    readFrame: () => renderer.flush(),
    projectPoint: (point: {x: number; y: number}) => point,
    subscribeFrames: () => () => {},
    pointerMove(inputValue: RootPointerInput) {
      calls.pointerMoves.push(inputValue)
      return run
    },
    pointerDown(inputValue: RootPointerInput) {
      calls.pointerDowns.push(inputValue)
      return run
    },
    pointerUp(inputValue: RootPointerInput) {
      calls.pointerUps.push(inputValue)
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
