import {createDomInspector, type DomInspector, type DomInspectorNode} from "@zavx0z/dom-devtools"
import {
  Event,
  HTMLElement,
  HTMLInputElement,
  HTMLTextAreaElement,
  type Element,
  type Node,
} from "@zavx0z/dom"
import type {ExternalStorybookPackageTabModel} from "./model.ts"
import type {ExternalStorybookShell} from "./shell.ts"

export const STORYBOOK_AGENT_BRIDGE_GLOBAL = "__EXTERNAL_STORYBOOK_AGENT_BRIDGE__" as const
export const STORYBOOK_AGENT_BRIDGE_PROTOCOL = "external-storybook-agent-bridge/1" as const

export type StorybookAgentTarget = Readonly<{
  nodeId?: string
  role?: string
  name?: string
}>

export type StorybookAgentBridgeRequest = Readonly<{
  protocol: typeof STORYBOOK_AGENT_BRIDGE_PROTOCOL
  operation: "state" | "inspect" | "interact" | "capture"
  include?: readonly string[]
  maxDepth?: number
  limit?: number
  cursor?: string
  target?: StorybookAgentTarget
  destination?: StorybookAgentTarget
  action?: "hover" | "focus" | "click" | "pointerDown" | "pointerUp" | "drag" | "key" | "type" | "wheel" | "scenario"
  value?: unknown
  timeoutMs?: number
}>

export type StorybookAgentBridge = Readonly<{
  protocol: typeof STORYBOOK_AGENT_BRIDGE_PROTOCOL
  call(method: "identity" | "inspect" | "interact" | "capture", params?: unknown): Promise<unknown>
  invoke(request: StorybookAgentBridgeRequest): Promise<unknown>
  dispose(): void
}>

export type CreateStorybookAgentBridgeOptions = Readonly<{
  packageId: string
  revision: string
  graphDigest: string
  shell: ExternalStorybookShell
  getRoute(): string
  getModel(): ExternalStorybookPackageTabModel
  navigate(route: string): Promise<void>
}>

export function createStorybookAgentBridge(
  options: CreateStorybookAgentBridgeOptions,
): StorybookAgentBridge {
  const inspector = createDomInspector({
    document: options.shell.document,
    renderer: options.shell.workbenchOverlay.renderer,
  })
  let disposed = false

  const bridge: StorybookAgentBridge = Object.freeze({
    protocol: STORYBOOK_AGENT_BRIDGE_PROTOCOL,
    call(method, params) {
      if (method === "identity") return Promise.resolve(state())
      const record = params !== null && typeof params === "object" && !Array.isArray(params)
        ? params as Record<string, unknown>
        : {}
      return bridge.invoke({
        ...record,
        protocol: STORYBOOK_AGENT_BRIDGE_PROTOCOL,
        operation: method,
      } as StorybookAgentBridgeRequest)
    },
    async invoke(request) {
      assertActive()
      validateRequest(request)
      if (request.operation === "state") return state()
      if (request.operation === "inspect") return inspect(request)
      if (request.operation === "capture") return capture(request)
      return interact(request)
    },
    dispose() {
      if (disposed) return
      disposed = true
      inspector.dispose()
      const globalRecord = globalThis as typeof globalThis & Record<string, unknown>
      if (globalRecord[STORYBOOK_AGENT_BRIDGE_GLOBAL] === bridge) {
        delete globalRecord[STORYBOOK_AGENT_BRIDGE_GLOBAL]
      }
    },
  })
  ;(globalThis as typeof globalThis & Record<string, unknown>)[STORYBOOK_AGENT_BRIDGE_GLOBAL] = bridge
  return bridge

  function state() {
    const model = options.getModel()
    return Object.freeze({
      protocol: STORYBOOK_AGENT_BRIDGE_PROTOCOL,
      packageId: options.packageId,
      revision: options.revision,
      graphDigest: options.graphDigest,
      route: options.getRoute(),
      viewName: options.shell.browserDocument.defaultView?.name ?? "",
      markers: Object.freeze({
        package: options.shell.browserDocument.documentElement.dataset.externalStorybookPackage ?? null,
        packageId: options.shell.browserDocument.documentElement.dataset.externalStorybookPackageId ?? null,
        route: options.shell.browserDocument.documentElement.dataset.externalStorybookRoute ?? null,
        revision: options.shell.browserDocument.documentElement.dataset.externalStorybookRevision ?? null,
      }),
      ready: options.shell.browserDocument.documentElement.dataset.externalStorybookPackage === "ready",
      presented: options.shell.presentedFrameSequence > 0,
      error: options.shell.browserDocument.documentElement.dataset.externalStorybookError ?? null,
      timeOrigin: performance.timeOrigin,
      frameSequence: options.shell.presentedFrameSequence,
      selected: Object.freeze({
        categoryId: model.catalogActiveId,
        subjectId: model.secondaryActiveId,
        variantId: model.variantActiveId,
      }),
      canvas: Object.freeze({
        id: options.shell.canvas.id,
        width: options.shell.canvas.width,
        height: options.shell.canvas.height,
        hidden: options.shell.canvas.hidden,
      }),
    })
  }

  function inspect(request: StorybookAgentBridgeRequest) {
    const defaultInspection = request.include === undefined
    const include = new Set(request.include ?? ["state", "diagnostics", "semantic", "canvas"])
    const stateProjection = state()
    const {canvas, ...identity} = stateProjection
    const needsNodes = include.has("semantic") || include.has("layout") || include.has("display")
    if (!needsNodes) {
      return Object.freeze({
        ...identity,
        ...(include.has("diagnostics") ? {
          diagnostics: identity.error === null ? Object.freeze([]) : Object.freeze([identity.error]),
        } : {}),
        ...(include.has("canvas") ? {canvas} : {}),
      })
    }
    const maximumDepth = boundedInteger(request.maxDepth ?? (defaultInspection ? 2 : 4), 0, 12, "maxDepth")
    const limit = boundedInteger(request.limit ?? (defaultInspection ? 40 : 80), 1, 200, "limit")
    const offset = decodeCursor(request.cursor)
    const snapshot = inspector.snapshot(options.shell.workbench.element)
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node] as const))
    const depths = new Map<number, number>([[snapshot.root, 0]])
    const ordered = snapshot.nodes.filter((node) => {
      const parentDepth = node.parent === null ? -1 : depths.get(node.parent) ?? -1
      const depth = node.id === snapshot.root ? 0 : parentDepth + 1
      depths.set(node.id, depth)
      return depth <= maximumDepth
    })
    const page = ordered.slice(offset, offset + limit)
    return Object.freeze({
      ...identity,
      ...(include.has("diagnostics") ? {
        diagnostics: identity.error === null ? Object.freeze([]) : Object.freeze([identity.error]),
      } : {}),
      ...(include.has("canvas") ? {canvas} : {}),
      semantic: Object.freeze({
        mutationVersion: snapshot.mutationVersion,
        stateVersion: snapshot.stateVersion,
        root: agentNodeId(snapshot.root),
        nodes: Object.freeze(page.map((node) => projectNode(node, byId, inspector, {
          layout: include.has("layout"),
          display: include.has("display"),
        }))),
        nextCursor: offset + page.length < ordered.length ? encodeCursor(offset + page.length) : null,
        total: ordered.length,
      }),
    })
  }

  async function interact(request: StorybookAgentBridgeRequest) {
    const action = request.action
    if (action === undefined) throw new Error("Storybook agent interaction action is required")
    boundedInteger(request.timeoutMs ?? 8_000, 1, 30_000, "timeoutMs")
    const before = options.shell.presentedFrameSequence
    if (action === "scenario") {
      if (typeof request.value !== "string" || request.value.length === 0 || request.value.length > 256) {
        throw new Error("Storybook scenario value must be a bounded route or variant id")
      }
      const model = options.getModel()
      const scenario = model.variants.find(({id, route}) => id === request.value || route === request.value)
      if (scenario === undefined) throw new Error(`Unknown Storybook scenario: ${request.value}`)
      await options.navigate(scenario.route)
    } else {
      const node = resolveTarget(request.target, inspector)
      await applyNodeAction(action, node, request, inspector, options.shell)
    }
    const frameSequence = options.shell.presentFrame()
    if (frameSequence <= before) throw new Error("Storybook interaction did not present a new frame")
    return Object.freeze({ok: true, action, frameSequence, state: state()})
  }

  async function capture(request: StorybookAgentBridgeRequest) {
    boundedInteger(request.timeoutMs ?? 8_000, 1, 30_000, "timeoutMs")
    const before = options.shell.presentedFrameSequence
    const frameSequence = options.shell.presentFrame()
    if (frameSequence <= before) throw new Error("Storybook capture did not present a new frame")
    const area = typeof (request as Record<string, unknown>).area === "string"
      ? String((request as Record<string, unknown>).area)
      : "workbench"
    let clip: Readonly<{x: number; y: number; width: number; height: number; scale: number}>
    if (area === "canvas") {
      const box = options.shell.canvas.getBoundingClientRect()
      clip = exactClip(box.left, box.top, box.width, box.height)
    } else {
      const semantic = area === "preview"
        ? options.shell.workbench.elements.previewHost
        : area === "node" && typeof (request as Record<string, unknown>).nodeId === "string"
          ? inspector.nodeForId(parseAgentNodeId(String((request as Record<string, unknown>).nodeId)))
          : options.shell.workbench.element
      if (semantic === null) throw new Error("Unknown Storybook capture node")
      const snapshot = inspector.snapshot(options.shell.workbench.element)
      const id = inspector.idForNode(semantic)
      const node = snapshot.nodes.find((candidate) => candidate.id === id)
      if (node?.box === undefined || node.box === null) throw new Error(`Storybook ${area} has no presented bounds`)
      clip = exactClip(node.box.x, node.box.y, node.box.width, node.box.height)
    }
    return Object.freeze({
      frameSequence,
      clip,
    })
  }

  function assertActive(): void {
    if (disposed) throw new Error("Storybook agent bridge is disposed")
  }
}

function projectNode(
  node: DomInspectorNode,
  byId: ReadonlyMap<number, DomInspectorNode>,
  inspector: DomInspector,
  include: Readonly<{layout: boolean; display: boolean}>,
) {
  const semantic = inspector.nodeForId(node.id)
  const attributes = new Map(node.attributes.map(({name, value}) => [name, value] as const))
  const role = attributes.get("role") ?? node.hit?.role ?? implicitRole(node.localName, attributes)
  const name = accessibleName(semantic, attributes, byId, inspector)
  const text = compactText(semantic?.textContent ?? node.nodeValue ?? "")
  return Object.freeze({
    nodeId: agentNodeId(node.id),
    tag: node.localName,
    role,
    name,
    text,
    states: Object.freeze({
      focused: Boolean(node.state?.focused),
      disabled: node.hit?.disabled ?? attributes.has("disabled"),
      selected: booleanAttribute(attributes.get("aria-selected")),
      expanded: optionalBooleanAttribute(attributes.get("aria-expanded")),
    }),
    ...(include.layout ? {bounds: node.box === undefined ? null : node.box} : {}),
    ...(include.display ? {
      display: node.display ?? Object.freeze([]),
      hit: node.hit ?? null,
    } : {}),
    childCount: node.children.length,
    parentId: node.parent === null ? null : agentNodeId(node.parent),
  })
}

async function applyNodeAction(
  action: NonNullable<StorybookAgentBridgeRequest["action"]>,
  node: Node,
  request: StorybookAgentBridgeRequest,
  inspector: DomInspector,
  shell: ExternalStorybookShell,
): Promise<void> {
  const snapshot = inspector.snapshot(shell.workbench.element)
  const record = snapshot.nodes.find(({id}) => inspector.nodeForId(id) === node)
  const box = record?.hit ?? record?.box ?? null
  const point = box === null ? null : {x: box.x + box.width / 2, y: box.y + box.height / 2}
  const pointer = (buttons: number) => {
    if (point === null) throw new Error("Storybook semantic target has no presented bounds")
    return {clientX: point.x, clientY: point.y, pointerId: 1, pointerType: "mouse", button: 0, buttons}
  }
  if (action === "hover") shell.workbenchOverlay.interaction.pointerMove(shell.workbenchOverlay.frame, pointer(0))
  else if (action === "pointerDown") shell.workbenchOverlay.interaction.pointerDown(shell.workbenchOverlay.frame, pointer(1))
  else if (action === "pointerUp") shell.workbenchOverlay.interaction.pointerUp(shell.workbenchOverlay.frame, pointer(0))
  else if (action === "click") {
    shell.workbenchOverlay.interaction.pointerDown(shell.workbenchOverlay.frame, pointer(1))
    shell.workbenchOverlay.interaction.pointerUp(shell.workbenchOverlay.frame, pointer(0))
  } else if (action === "drag") {
    if (point === null) throw new Error("Storybook drag source requires presented bounds")
    let destinationPoint: Readonly<{x: number; y: number}>
    if (request.destination !== undefined) {
      const destination = resolveTarget(request.destination, inspector)
      const target = snapshot.nodes.find(({id}) => inspector.nodeForId(id) === destination)
      const destinationBox = target?.hit ?? target?.box ?? null
      if (destinationBox === null) throw new Error("Storybook drag destination requires presented bounds")
      destinationPoint = Object.freeze({
        x: destinationBox.x + destinationBox.width / 2,
        y: destinationBox.y + destinationBox.height / 2,
      })
    } else {
      const delta = request.value !== null && typeof request.value === "object" && !Array.isArray(request.value)
        ? request.value as Record<string, unknown>
        : null
      const dx = finiteNumber(delta?.dx, -10_000, 10_000, "drag dx")
      const dy = finiteNumber(delta?.dy, -10_000, 10_000, "drag dy")
      const viewport = shell.workbenchOverlay.frame.viewport
      destinationPoint = Object.freeze({
        x: Math.max(0, Math.min(viewport.width, point.x + dx)),
        y: Math.max(0, Math.min(viewport.height, point.y + dy)),
      })
    }
    if (shell.applyWorldPreviewGesture(node, {
      kind: "orbit",
      deltaX: destinationPoint.x - point.x,
      deltaY: destinationPoint.y - point.y,
    })) return
    shell.workbenchOverlay.interaction.pointerDown(shell.workbenchOverlay.frame, pointer(1))
    shell.workbenchOverlay.interaction.pointerMove(shell.workbenchOverlay.frame, {
      ...pointer(1),
      clientX: destinationPoint.x,
      clientY: destinationPoint.y,
    })
    shell.workbenchOverlay.interaction.pointerUp(shell.workbenchOverlay.frame, {
      ...pointer(0),
      clientX: destinationPoint.x,
      clientY: destinationPoint.y,
    })
  } else if (action === "wheel") {
    const wheelValue = request.value !== null && typeof request.value === "object" && !Array.isArray(request.value)
      ? request.value as Record<string, unknown>
      : null
    const delta = finiteNumber(wheelValue?.deltaY ?? request.value ?? 120, -10_000, 10_000, "wheel value")
    if (point === null) throw new Error("Storybook wheel target has no presented bounds")
    if (shell.applyWorldPreviewGesture(node, {kind: "pan", deltaX: 0, deltaY: delta})) return
    shell.workbenchOverlay.interaction.wheel(shell.workbenchOverlay.frame, {
      clientX: point.x,
      clientY: point.y,
      deltaY: delta,
    })
  } else if (action === "focus") {
    if (!(node instanceof HTMLElement)) throw new Error("Storybook focus target is not an HTMLElement")
    node.focus()
  } else if (action === "key") {
    if (!(node instanceof HTMLElement)) throw new Error("Storybook key target is not an HTMLElement")
    const keyValue = request.value !== null && typeof request.value === "object" && !Array.isArray(request.value)
      ? request.value as Record<string, unknown>
      : null
    const key = boundedText(keyValue?.key ?? request.value, 64, "key value")
    const modifiers = Array.isArray(keyValue?.modifiers)
      ? new Set(keyValue.modifiers.filter((value): value is string => typeof value === "string"))
      : new Set<string>()
    shell.dispatchNativeKey(node, {
      key,
      altKey: modifiers.has("alt"),
      ctrlKey: modifiers.has("ctrl"),
      metaKey: modifiers.has("meta"),
      shiftKey: modifiers.has("shift"),
    })
  } else if (action === "type") {
    const text = boundedText(request.value !== null && typeof request.value === "object" && !Array.isArray(request.value)
      ? (request.value as Record<string, unknown>).text
      : request.value, 4_096, "type value")
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      node.value = `${node.value}${text}`
      node.dispatchEvent(new Event("input", {bubbles: true, composed: true}))
    } else {
      throw new Error("Storybook type target is not a text control")
    }
  } else {
    throw new Error(`Unsupported Storybook node action: ${action}`)
  }
}

function resolveTarget(target: StorybookAgentTarget | undefined, inspector: DomInspector): Node {
  if (target === undefined) throw new Error("Storybook semantic target is required")
  if (target.nodeId !== undefined) {
    const id = parseAgentNodeId(target.nodeId)
    const node = inspector.nodeForId(id)
    if (node === null) throw new Error(`Unknown Storybook semantic node: ${target.nodeId}`)
    return node
  }
  if (typeof target.role !== "string" || typeof target.name !== "string") {
    throw new Error("Storybook target requires exact nodeId or role and name")
  }
  const snapshot = inspector.snapshot()
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node] as const))
  const matches = snapshot.nodes.filter((node) => {
    const semantic = inspector.nodeForId(node.id)
    const attributes = new Map(node.attributes.map(({name, value}) => [name, value] as const))
    const role = attributes.get("role") ?? node.hit?.role ?? implicitRole(node.localName, attributes)
    return role === target.role && accessibleName(semantic, attributes, byId, inspector) === target.name
  })
  if (matches.length === 0) throw new Error(`Unknown Storybook semantic target: ${target.role} ${target.name}`)
  if (matches.length > 1) throw new Error(`Ambiguous Storybook semantic target: ${target.role} ${target.name}`)
  return inspector.nodeForId(matches[0]!.id)!
}

function accessibleName(
  node: Node | null,
  attributes: ReadonlyMap<string, string>,
  _byId: ReadonlyMap<number, DomInspectorNode>,
  _inspector: DomInspector,
): string {
  const explicit = attributes.get("aria-label") ?? attributes.get("title")
  if (explicit !== undefined && explicit.trim().length > 0) return compactText(explicit)
  return compactText(node?.textContent ?? "")
}

function implicitRole(
  localName: string | null,
  attributes: ReadonlyMap<string, string>,
): string | null {
  if (localName === "button") return "button"
  if (localName === "nav") return "navigation"
  if (localName === "main") return "main"
  if (localName === "input") {
    const type = (attributes.get("type") ?? "text").toLowerCase()
    if (type === "checkbox") return "checkbox"
    if (type === "radio") return "radio"
    if (type === "range") return "slider"
    if (type === "button" || type === "submit" || type === "reset") return "button"
    if (type === "number") return "spinbutton"
    if (type === "search") return "searchbox"
    return "textbox"
  }
  if (localName === "textarea") return "textbox"
  if (localName === "a") return "link"
  return null
}

function agentNodeId(id: number): string {
  return `node:${id}`
}

function parseAgentNodeId(value: string): number {
  const match = /^node:([1-9][0-9]*)$/u.exec(value)
  if (match === null) throw new Error(`Invalid Storybook semantic node identity: ${value}`)
  const id = Number(match[1])
  if (!Number.isSafeInteger(id)) throw new Error(`Invalid Storybook semantic node identity: ${value}`)
  return id
}

function compactText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 240)
}

function booleanAttribute(value: string | undefined): boolean {
  return value === "true" || value === "" || value === "selected"
}

function optionalBooleanAttribute(value: string | undefined): boolean | null {
  return value === undefined ? null : booleanAttribute(value)
}

function validateRequest(value: StorybookAgentBridgeRequest): void {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    value.protocol !== STORYBOOK_AGENT_BRIDGE_PROTOCOL ||
    !["state", "inspect", "interact", "capture"].includes(value.operation)) {
    throw new Error("Invalid Storybook agent bridge request")
  }
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Storybook ${label} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function finiteNumber(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`Storybook ${label} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function boundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000\u000b\u000c]/u.test(value)) {
    throw new Error(`Storybook ${label} must be bounded text`)
  }
  return value
}

function decodeCursor(value: string | undefined): number {
  if (value === undefined) return 0
  const match = /^offset:([0-9]+)$/u.exec(value)
  if (match === null) throw new Error("Invalid Storybook semantic cursor")
  return boundedInteger(Number(match[1]), 0, 1_000_000, "cursor")
}

function encodeCursor(value: number): string {
  return `offset:${value}`
}

function exactClip(x: number, y: number, width: number, height: number) {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error("Storybook capture region is empty")
  }
  return Object.freeze({x, y, width, height, scale: 1})
}
