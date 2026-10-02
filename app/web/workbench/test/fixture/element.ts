import type {Node, HTMLElement} from "@zavx0z/dom"

export function exactWorkbenchElement(root: Node, selector: string, label: string): HTMLElement {
  if (!("querySelectorAll" in root)) throw new TypeError(`${label} root cannot be queried`)
  const matches = [...(root as Node & {
    querySelectorAll(selector: string): readonly HTMLElement[]
  }).querySelectorAll(selector)]
  if (matches.length !== 1) {
    throw new Error(`${label} must have one exact element, received ${matches.length}`)
  }
  return matches[0]!
}
