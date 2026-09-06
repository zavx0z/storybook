import {type Document, Node} from "@zavx0z/dom"
import type {
  WorkbenchElements,
  WorkbenchPresentation,
  WorkbenchProjectionHosts,
} from "./contract.ts"

export function validateWorkbenchPresentation(
  value: unknown,
  document?: Document,
): WorkbenchPresentation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Workbench presentation must be an object")
  }
  const candidate = value as WorkbenchPresentation
  if (candidate.projection !== "display" && candidate.projection !== "hud" &&
    candidate.projection !== "space") {
    throw new Error(`Unknown Workbench presentation projection: ${String(candidate.projection)}`)
  }
  if (candidate.node !== null && !(candidate.node instanceof Node)) {
    throw new TypeError("Workbench presentation node must be a Node from @zavx0z/dom")
  }
  if (document !== undefined && candidate.node !== null) {
    assertNodeInDocument(candidate.node, document, "Presentation node")
  }
  return Object.freeze({node: candidate.node, projection: candidate.projection})
}

export function syncWorkbenchPresentation(
  previous: WorkbenchPresentation | null,
  next: WorkbenchPresentation,
  elements: WorkbenchElements,
  document: Document,
  projectionHosts: WorkbenchProjectionHosts = Object.freeze({}),
): void {
  if (next.node !== null) assertNodeInDocument(next.node, document, "Presentation node")
  const previousNode = previous?.node ?? null
  if (previousNode !== null && previousNode !== next.node && previousNode.parentNode !== null) {
    previousNode.parentNode.removeChild(previousNode)
  }
  if (next.node === null) return
  const host = next.projection === "display"
    ? projectionHosts.display ?? elements.displayHost
    : next.projection === "hud"
      ? elements.hudHost
      : projectionHosts.space ?? elements.spaceHost
  if (next.node.parentNode !== host) host.appendChild(next.node)
}

export function validateWorkbenchProjectionHosts(
  value: WorkbenchProjectionHosts | undefined,
  document: Document,
): WorkbenchProjectionHosts {
  if (value === undefined) return Object.freeze({})
  const output: {display?: Node; space?: Node} = {}
  for (const kind of ["display", "space"] as const) {
    const node = value[kind]
    if (node === undefined) continue
    assertNodeInDocument(node, document, `Workbench ${kind} projection host`)
    output[kind] = node
  }
  return Object.freeze(output)
}

export function assertNodeInDocument(node: Node, document: Document, label: string): void {
  if (!(node instanceof Node)) throw new TypeError(`${label} must be a Node from @zavx0z/dom`)
  if (node !== document && node.ownerDocument !== document) {
    throw new Error(`${label} belongs to another Document`)
  }
}
