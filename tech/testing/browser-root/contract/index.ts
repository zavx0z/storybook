import type {ComponentValue} from "@zavx0z/immersive/XReact"
import type {JSX} from "@zavx0z/immersive/XReact"
import type {IntegrationOptions, IntegrationRoot, Presentation} from "@zavx0z/immersive/XReact/browser/integration"

type PresentationFixtureOptions = IntegrationOptions & {
  canvas: HTMLCanvasElement
  app: ComponentValue | JSX.Element
}

export declare namespace StorybookTechTestingBrowserRoot {
  /** Тестовая реализация готового Browser presentation. */
  type Input = (options: PresentationFixtureOptions) => Promise<Presentation>
  /** Синхронный корень с явными render, whenReady и unmount. */
  type Output = (canvas: HTMLCanvasElement, options?: IntegrationOptions) => IntegrationRoot
}
