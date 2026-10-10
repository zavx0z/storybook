/**
Монтирует governed представление в уже существующем semantic Document.
Полученный DOM-узел или диапазон сохраняет identity и DOMRoot при переносе в область
того же Document. Новый Browser Root, Canvas или цикл ввода не создаётся.

@packageDocumentation
*/
import type {Element, HTMLElement} from "@zavx0z/immersive"
import {createDomRoot} from "@zavx0z/immersive"
import type {StorybookAppWebPagePresentation} from "./contract"
export type {StorybookAppWebPagePresentation} from "./contract"

/**
Создаёт представление в staging, сохраняя весь результат компонента.
Selector выбирает элемент для геометрии и поиска, но не обрезает соседние узлы.

@param document - Semantic Document уже созданного Experience.

@param template - Governed шаблон представления.

@param props - Входные данные того же шаблона.

@param selector - Selector, который после render обязан найти ровно один Element.

@returns DOM-результат, выбранный Element и DOMRoot; потребитель обязан вызвать dispose.

@throws При неверном selector, ошибке render или числе найденных корней, отличном от одного.
При нарушении количества корней созданный DOMRoot освобождается.

@example
```ts
const view = createPresentation(document, template, props, "[data-preview]")
try {
  document.append(view.node)
} finally {
  view.dispose()
}
```
*/
export default function createStorybookComponentPresentation<Props, Root extends Element = HTMLElement>(
  document: StorybookAppWebPagePresentation.Input<Props>[0],
  template: StorybookAppWebPagePresentation.Input<Props>[1],
  props: StorybookAppWebPagePresentation.Input<Props>[2],
  selector: StorybookAppWebPagePresentation.Input<Props>[3],
): StorybookAppWebPagePresentation.Output<Root> {
  const staging = document.createDocumentFragment()
  const componentRoot = createDomRoot(staging)
  let element: Root
  try {
    componentRoot.render(template, props)
    const matches = [...staging.querySelectorAll(selector)]
    if (matches.length !== 1) {
      throw new Error(`Storybook component presentation requires one ${selector}, received ${matches.length}`)
    }
    element = matches[0] as Root
  } catch (error) {
    componentRoot.unmount()
    throw error
  }
  const node = componentRoot.current!
  node.remove()
  let disposed = false
  return Object.freeze({
    element,
    node,
    componentRoot,
    dispose() {
      if (disposed) return
      disposed = true
      componentRoot.unmount()
    },
  })
}
