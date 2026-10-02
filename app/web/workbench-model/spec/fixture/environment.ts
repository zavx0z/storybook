import {createRoot} from "@zavx0z/component"
import {createDocument} from "@zavx0z/dom"
import {createSpaceElementFactories} from "@zavx0z/space"

/** Среда одного ComponentRoot без native Canvas, GPU или дополнительного semantic Document. */
export function createFrameEnvironment() {
  const document = createDocument({elementFactories: createSpaceElementFactories()})
  const container = document.createElement("div")
  document.append(container)
  const component = createRoot(container)
  return {document, container, component}
}
