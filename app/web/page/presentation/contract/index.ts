import type {Document, Element, HTMLElement} from "@zavx0z/immersive"
import type {ComponentRoot} from "@zavx0z/immersive/XReact"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"

export declare namespace StorybookAppWebPagePresentation {
  /** Существующий Document, governed шаблон, его props и selector единственного корня. */
  export type Input<Props> = readonly [
    document: Document,
    template: CompiledTemplate<Props>,
    props: Readonly<Props>,
    selector: string,
  ]

  /**
Отделённый semantic корень с удержанным ComponentRoot.

@property element - Тот же node после отделения от staging; потребитель размещает его в данном Document.

@property componentRoot - Сохраняет состояние и допускает последующий render того же шаблона.
*/
  export type Output<Root extends Element = HTMLElement> = Readonly<{
    element: Root
    componentRoot: ComponentRoot
    /** Освобождает ComponentRoot и удаляет element из его текущего родителя; повторный вызов безопасен. */
    dispose(): void
  }>
}
