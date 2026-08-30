import {type Document, Node} from "@zavx0z/dom"
import type {
  WorkbenchElements,
  WorkbenchPresentation,
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
    candidate.projection !== "world") {
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
): void {
  if (next.node !== null) assertNodeInDocument(next.node, document, "Presentation node")
  const previousNode = previous?.node ?? null
  if (previousNode !== null && previousNode !== next.node && previousNode.parentNode !== null) {
    previousNode.parentNode.removeChild(previousNode)
  }
  if (next.node === null) return
  const host = next.projection === "display"
    ? elements.displayHost
    : next.projection === "hud"
      ? elements.hudHost
      : elements.worldHost
  if (next.node.parentNode !== host) host.appendChild(next.node)
}

export function assertNodeInDocument(node: Node, document: Document, label: string): void {
  if (!(node instanceof Node)) throw new TypeError(`${label} must be a Node from @zavx0z/dom`)
  if (node !== document && node.ownerDocument !== document) {
    throw new Error(`${label} belongs to another Document`)
  }
}
