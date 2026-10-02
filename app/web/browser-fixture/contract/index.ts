import type {ComponentValue} from "@zavx0z/component"
import type {JSX} from "@jsx-compiler/session"
import type {IntegrationOptions, IntegrationRoot, Presentation} from "@zavx0z/browser/integration"

type PresentationFixtureOptions = IntegrationOptions & {
  canvas: HTMLCanvasElement
  app: ComponentValue | JSX.Element
}

export declare namespace WebBrowserFixture {
  /** Тестовая реализация готового Browser presentation. */
  type Input = (options: PresentationFixtureOptions) => Promise<Presentation>
  /** Синхронный корень с явными render, whenReady и unmount. */
  type Output = (canvas: HTMLCanvasElement, options?: IntegrationOptions) => IntegrationRoot
}
