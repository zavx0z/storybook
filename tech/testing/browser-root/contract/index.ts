import type {DOMConstruction} from "@zavx0z/immersive"
import type {JSX} from "@zavx0z/immersive/XReact"
import type {IntegrationOptions, IntegrationRoot, Presentation} from "@zavx0z/immersive"

type PresentationFixtureOptions = IntegrationOptions & {
  canvas: HTMLCanvasElement
  app: DOMConstruction<any> | JSX.Element
}

export declare namespace StorybookTechTestingBrowserRoot {
  /** Тестовая реализация готового Browser presentation. */
  type Input = (options: PresentationFixtureOptions) => Promise<Presentation>
  /** Синхронный корень с явными render, whenReady и unmount. */
  type Output = (canvas: HTMLCanvasElement, options?: IntegrationOptions) => IntegrationRoot
}
