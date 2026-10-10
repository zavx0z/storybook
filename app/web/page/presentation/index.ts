/**
Монтирует governed представление в уже существующем semantic Document.
Полученный Element сохраняет identity и ComponentRoot при переносе в область
того же Document. Новый Browser Root, Canvas или цикл ввода не создаётся.

@packageDocumentation
*/
import type {Element, HTMLElement} from "@zavx0z/immersive"
import {createRoot} from "@zavx0z/immersive/XReact"
import type {StorybookAppWebPagePresentation} from "./contract"
export type {StorybookAppWebPagePresentation} from "./contract"

/**
Создаёт представление в staging и отделяет единственный найденный корень.

@param document - Semantic Document уже созданного Experience.

@param template - Governed шаблон представления.

@param props - Входные данные того же шаблона.

@param selector - Selector, который после render обязан найти ровно один Element.

@returns Отделённый Element и его ComponentRoot; потребитель обязан вызвать dispose.

@throws При неверном selector, ошибке render или числе найденных корней, отличном от одного.
При нарушении количества корней созданный ComponentRoot освобождается.

@example
```ts
const view = createPresentation(document, template, props, "[data-preview]")
try {
  document.append(view.element)
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
