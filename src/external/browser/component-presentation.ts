import type {Document, Element, HTMLElement} from "@zavx0z/dom"
import {createRoot, type ComponentRoot} from "@zavx0z/component"
import type {CompiledTemplate} from "@zavx0z/template/compiled"

export type StorybookComponentPresentation<Root extends Element = HTMLElement> = Readonly<{
  element: Root
  componentRoot: ComponentRoot
  dispose(): void
}>

/** Mounts one governed view without constructing a visible element imperatively. */
export function createStorybookComponentPresentation<Props, Root extends Element = HTMLElement>(
  document: Document,
  template: CompiledTemplate<Props>,
  props: Readonly<Props>,
  selector: string,
): StorybookComponentPresentation<Root> {
  const staging = document.createDocumentFragment()
  const componentRoot = createRoot(staging)
  componentRoot.render(template, props)
  const matches = [...staging.querySelectorAll(selector)]
  if (matches.length !== 1) {
    componentRoot.unmount()
    throw new Error(`Storybook component presentation requires one ${selector}, received ${matches.length}`)
  }
  const element = matches[0] as Root
  staging.removeChild(element)
  let disposed = false
  return Object.freeze({
    element,
    componentRoot,
    dispose() {
      if (disposed) return
      disposed = true
      componentRoot.unmount()
      if (element.parentNode !== null) element.parentNode.removeChild(element)
    },
  })
}
