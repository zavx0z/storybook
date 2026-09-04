import type {Document, Element, HTMLElement, Node} from "@zavx0z/dom"
import type {ComponentRoot} from "@zavx0z/component"

export type SelfStoryPresentation = Readonly<{
  element: HTMLElement
  root: ComponentRoot
  source: Readonly<{
    html: string
    typescript: string
  }>
  props?: Readonly<Record<string, unknown>>
  dispose(): void
}>

export type SelfStoryDescriptor = Readonly<{
  create(document: Document): SelfStoryPresentation
}>

export function defineSelfStory(
  create: SelfStoryDescriptor["create"],
): SelfStoryDescriptor {
  return Object.freeze({create})
}

export function serializeSelfElement(element: HTMLElement): string {
  return serializeElement(element, 0)
}

function serializeElement(element: Element, depth: number): string {
  const indent = "  ".repeat(depth)
  const attributes = element.getAttributeNames().sort().map((name) =>
    ` ${name}="${escapeHtml(element.getAttribute(name) ?? "")}"`).join("")
  const children = [...element.childNodes].filter((node) => node.nodeType !== 8)
  if (children.length === 0) return `${indent}<${element.localName}${attributes}></${element.localName}>`
  if (children.every((node) => node.nodeType === 3)) {
    return `${indent}<${element.localName}${attributes}>${escapeHtml(element.textContent ?? "")}</${element.localName}>`
  }
  const body = children.map((node: Node) => {
    if (node.nodeType === 3) {
      return `${"  ".repeat(depth + 1)}${escapeHtml(node.textContent ?? "")}`
    }
    if (node.nodeType !== 1) {
      throw new TypeError(`Cannot serialize self Storybook node type ${node.nodeType}`)
    }
    return serializeElement(node as HTMLElement, depth + 1)
  }).join("\n")
  return `${indent}<${element.localName}${attributes}>\n${body}\n${indent}</${element.localName}>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
