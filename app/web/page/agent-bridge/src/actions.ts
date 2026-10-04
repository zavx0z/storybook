import {HTMLElement, HTMLLabelElement, type Node} from "@zavx0z/immersive-dom"
import type {DomInspector, DomInspectorNode} from "@zavx0z/immersive-devtool"
import type {Request, Target} from "../contract/request"
import type {Shell} from "../contract/shell"
import {STORYBOOK_AGENT_BRIDGE_PROTOCOL} from "./protocol"

export function projectNode(
  node: DomInspectorNode,
  inspector: DomInspector,
  include: Readonly<{layout: boolean; display: boolean}>,
) {
  const semantic = inspector.nodeForId(node.id)
  const attributes = new Map(node.attributes.map(({name, value}) => [name, value] as const))
  const role = attributes.get("role") ?? node.hit?.role ?? implicitRole(node.localName, attributes)
  const name = accessibleName(semantic, attributes)
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
    ...(node.children.length === 0 ? {} : {subtreeCursor: encodeCursor(0, node.id)}),
    parentId: node.parent === null ? null : agentNodeId(node.parent),
  })
}

export async function applyNodeAction(
  action: NonNullable<Request["action"]>,
  node: Node,
  request: Request,
  inspector: DomInspector,
  shell: Shell,
): Promise<void> {
  const presentedPoint = (target: Node) => {
    const owner = shell.projectionFor(target)
    const projection = owner.kind === "space" ? shell.projectionFor(shell.workbench.element) : owner
    if (projection.kind === "space") return null
    const frame = projection.readFrame()
    const hit = owner.kind === "space" ? undefined : frame?.hits.get(target)
    const preview = owner.kind === "space" ? frame?.boxByNode.get(shell.workbench.elements.previewHost) : undefined
    const bounds = owner.kind === "space" ? preview : hit ?? frame?.boxByNode.get(target)
    if (bounds === undefined) return null
    const presentationOwner = hit?.path?.presentationOwner
    const transform = presentationOwner === null || presentationOwner === undefined
      ? bounds.transform
      : frame?.presentationTransforms?.get(presentationOwner) ?? bounds.transform
    // CSS transform переводит layout-точку в viewport проекции; Browser проецирует её один раз.
    const x = preview === undefined ? bounds.x + bounds.width / 2 : preview.contentX + preview.contentWidth / 2
    const y = preview === undefined ? bounds.y + bounds.height / 2 : preview.contentY + preview.contentHeight / 2
    const point = {x: x * transform.scaleX + transform.translateX, y: y * transform.scaleY + transform.translateY}
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Storybook semantic target has non-finite projection bounds")
    const clientPoint = projection.projectPoint(point)
    if (clientPoint !== null && (!Number.isFinite(clientPoint.x) || !Number.isFinite(clientPoint.y))) {
      throw new Error("Storybook semantic target has non-finite client bounds")
    }
    return clientPoint
  }
  const point = presentedPoint(node)
  const pointer = (
    buttons: number,
    target: Readonly<{x: number; y: number}> | null = point,
  ) => {
    if (target === null) throw new Error("Storybook semantic target has no presented bounds")
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new Error("Storybook semantic target has non-finite client bounds")
    return {x: target.x, y: target.y, pointerId: 1, pointerType: "mouse", button: 0, buttons}
  }
  if (action === "hover") shell.root.input.pointerMove(pointer(0))
  else if (action === "pointerDown") shell.root.input.pointerDown(pointer(1))
  else if (action === "pointerUp") shell.root.input.pointerUp(pointer(0))
  else if (action === "click") {
    const owner = shell.root.input
    owner.pointerDown(pointer(1))
    owner.pointerUp(pointer(0))
  } else if (action === "drag") {
    let destinationPoint: Readonly<{x: number; y: number}>
    if (request.destination !== undefined) {
      if (point === null) throw new Error("Storybook drag source requires presented bounds")
      const destination = resolveTarget(request.destination, inspector)
      const destinationClientPoint = presentedPoint(destination)
      if (destinationClientPoint === null) throw new Error("Storybook drag destination is not presented")
      destinationPoint = destinationClientPoint
    } else {
      const delta = request.value !== null && typeof request.value === "object" && !Array.isArray(request.value)
        ? request.value as Record<string, unknown>
        : null
      const dx = finiteNumber(delta?.dx, -10_000, 10_000, "drag dx")
      const dy = finiteNumber(delta?.dy, -10_000, 10_000, "drag dy")
      if (point === null) throw new Error("Storybook drag source requires presented bounds")
      destinationPoint = {x: point.x + dx, y: point.y + dy}
    }
    if (point === null) throw new Error("Storybook drag source requires presented bounds")
    const owner = shell.root.input
    owner.pointerDown(pointer(1))
    owner.pointerMove(pointer(1, destinationPoint))
    owner.pointerUp(pointer(0, destinationPoint))
  } else if (action === "wheel") {
    const wheelValue = request.value !== null && typeof request.value === "object" && !Array.isArray(request.value)
      ? request.value as Record<string, unknown>
      : null
    const delta = finiteNumber(wheelValue?.deltaY ?? request.value ?? 120, -10_000, 10_000, "wheel value")
    if (point === null) throw new Error("Storybook wheel target has no presented bounds")
    shell.root.input.wheel({
      x: point.x,
      y: point.y,
      deltaX: finiteNumber(wheelValue?.deltaX ?? 0, -10_000, 10_000, "wheel deltaX"),
      deltaY: delta,
    })
  } else if (action === "focus") {
    if (!(node instanceof HTMLElement)) throw new Error("Storybook focus target is not an HTMLElement")
    node.focus()
  } else if (action === "key") {
    if (!(node instanceof HTMLElement)) throw new Error("Storybook key target is not an HTMLElement")
    if (shell.document.activeElement !== node) node.focus()
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
    if (!(node instanceof HTMLElement)) throw new Error("Storybook type target is not an HTMLElement")
    if (shell.document.activeElement !== node) node.focus()
    shell.dispatchNativeText(node, text)
  } else {
    throw new Error(`Unsupported Storybook node action: ${action}`)
  }
}

export function resolveTarget(target: Target | undefined, inspector: DomInspector): Node {
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
  const matches = snapshot.nodes.filter((node) => {
    const semantic = inspector.nodeForId(node.id)
    const attributes = new Map(node.attributes.map(({name, value}) => [name, value] as const))
    const role = attributes.get("role") ?? node.hit?.role ?? implicitRole(node.localName, attributes)
    return role === target.role && accessibleName(semantic, attributes) === target.name
  })
  if (matches.length === 0) throw new Error(`Unknown Storybook semantic target: ${target.role} ${target.name}`)
  // Скрытые retained панели могут содержать такие же кнопки, как активная.
  const presented = matches.filter(node => node.box !== null && node.box !== undefined &&
    node.box.width > 0 && node.box.height > 0)
  const candidates = presented.length > 0 ? presented : matches
  if (candidates.length > 1) throw new Error(`Ambiguous Storybook semantic target: ${target.role} ${target.name}`)
  return inspector.nodeForId(candidates[0]!.id)!
}

function accessibleName(
  node: Node | null,
  attributes: ReadonlyMap<string, string>,
): string {
  const explicit = attributes.get("aria-label")
  if (explicit !== undefined && explicit.trim().length > 0) return compactText(explicit)
  const labelledBy = attributes.get("aria-labelledby")?.trim().split(/\s+/u)
    .map(id => node?.ownerDocument?.getElementById(id)?.textContent ?? "").join(" ").trim()
  if (labelledBy) return compactText(labelledBy)
  if (node instanceof HTMLElement && ["input", "textarea", "select", "meter", "progress"].includes(node.localName)) {
    const labels = [...node.ownerDocument?.querySelectorAll("label") ?? []]
      .filter(label => label instanceof HTMLLabelElement && label.control === node)
      .map(label => label.textContent ?? "").join(" ").trim()
    if (labels) return compactText(labels)
  }
  const title = attributes.get("title")
  if (title?.trim()) return compactText(title)
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
  if (localName === "select") return attributes.has("multiple") ? "listbox" : "combobox"
  if (localName === "option") return "option"
  if (localName === "a") return "link"
  return null
}

export function agentNodeId(id: number): string {
  return `node:${id}`
}

export function parseAgentNodeId(value: string): number {
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

export function validateRequest(value: Request): void {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    value.protocol !== STORYBOOK_AGENT_BRIDGE_PROTOCOL ||
    !["state", "inspect", "interact", "capture", "applyRevision"].includes(value.operation)) {
    throw new Error("Invalid Storybook agent bridge request")
  }
}

export function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
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

export function boundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000\u000b\u000c]/u.test(value)) {
    throw new Error(`Storybook ${label} must be bounded text`)
  }
  return value
}

export function decodeCursor(value: string | undefined): Readonly<{offset: number; rootId?: number}> {
  if (value === undefined) return {offset: 0}
  const match = /^(?:subtree\.([1-9][0-9]*)\.offset\.|offset:)([0-9]+)$/u.exec(value)
  if (match === null) throw new Error("Invalid Storybook semantic cursor")
  return {
    offset: boundedInteger(Number(match[2]), 0, 1_000_000, "cursor"),
    ...(match[1] === undefined ? {} : {rootId: parseAgentNodeId(`node:${match[1]}`)}),
  }
}

export function encodeCursor(value: number, rootId?: number): string {
  return rootId === undefined ? `offset:${value}` : `subtree.${rootId}.offset.${value}`
}

export function exactClip(x: number, y: number, width: number, height: number) {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error("Storybook capture region is empty")
  }
  return Object.freeze({x, y, width, height, scale: 1})
}
