import {createDependencyPresentation} from "../../runtime/dependency-view.tsx"
import {defineSelfStory, serializeSelfElement} from "./story-types.ts"

/** Исполнимый пример того же представления, которое открывает структурная кнопка. */
export const dependencyExample = defineSelfStory(document => {
  const cases = [{
    name: "Example", file: "component/index.tsx", testName: "Зависимости $name",
    graph: {
      "component/index.tsx#Example": {uses: ["leaf.tsx#Leaf"], elements: ["article"]},
      "leaf.tsx#Leaf": {uses: [], elements: ["span"]},
    },
  }]
  const presentation = createDependencyPresentation(document, cases)
  return {
    element: presentation.element,
    root: presentation.componentRoot,
    source: {html: serializeSelfElement(presentation.element), typescript: JSON.stringify(cases, null, 2)},
    props: {name: "Example"},
    dispose: presentation.dispose,
  }
})
