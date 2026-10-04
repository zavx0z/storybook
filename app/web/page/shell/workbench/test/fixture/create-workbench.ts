import {createRoot} from "@immersive/component"
import type {HTMLDivElement, Document} from "@immersive/dom"
import type {WorkbenchModel} from "../../src/model-contract"
type CreateWorkbenchOptions = Omit<WorkbenchModel.Input, "document"> & {document: Document}
import {createWorkbenchModel} from "../../src/model"
import {WorkbenchView} from "../../src/view"
import {exactWorkbenchElement} from "./element"

export {createWorkbenchModel}

/** Изолированная проверка той же декларативной модели и раскладки Workbench. */
export function createWorkbench(options: CreateWorkbenchOptions) {
  const model = createWorkbenchModel(options)
  const staging = options.document.createDocumentFragment()
  const componentRoot = createRoot(staging, {identifierPrefix: "storybook-workbench"})
  const render = () => componentRoot.render(WorkbenchView as any, model.getSnapshot())
  const unsubscribe = model.subscribe(render)
  render()
  const element = exactWorkbenchElement(staging, "[data-storybook-workbench]", "Workbench root") as HTMLDivElement
  options.parent?.appendChild(element)
  componentRoot.flush()
  const workbench = model.bind(element)
  return {
    ...workbench,
    componentRoot,
    dispose() {
      unsubscribe()
      model.dispose()
      componentRoot.unmount()
      element.parentNode?.removeChild(element)
    },
  }
}
