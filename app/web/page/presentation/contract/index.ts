import type {Document, Element, HTMLElement, DOMComponent} from "@zavx0z/immersive"
import type {DOMRoot} from "@zavx0z/immersive"
import type {DOMComponentConstructor} from "@zavx0z/immersive"

export declare namespace StorybookAppWebPagePresentation {
  /** Существующий Document, governed шаблон, его props и selector единственного корня. */
  export type Input<Props> = readonly [
    document: Document,
    template: DOMComponentConstructor<Props>,
    props: Readonly<Props>,
    selector: string,
  ]

  /**
Полный semantic результат с удержанным DOMRoot.

@property node - Полный DOM-результат для размещения; диапазон сохраняет слоты и соседние узлы.

@property element - Найденный selector элемент для геометрии и поиска внутри представления.

@property componentRoot - Сохраняет состояние и допускает последующий render того же шаблона.
*/
  export type Output<Root extends Element = HTMLElement> = Readonly<{
    node: DOMComponent<unknown>
    element: Root
    componentRoot: DOMRoot
    /** Освобождает DOMRoot и удаляет весь результат из его текущего родителя; повторный вызов безопасен. */
    dispose(): void
  }>
}
