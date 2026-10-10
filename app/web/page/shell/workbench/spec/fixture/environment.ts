import {createDomRoot} from "@zavx0z/immersive"
import {createDocument} from "@zavx0z/immersive"
import {createSpaceElementFactories} from "@zavx0z/immersive/space"

/** Среда одного DOMRoot без native Canvas, GPU или дополнительного semantic Document. */
export function createFrameEnvironment() {
  const document = createDocument({elementFactories: createSpaceElementFactories()})
  const container = document.createElement("div")
  document.append(container)
  const component = createDomRoot(container)
  return {document, container, component}
}
