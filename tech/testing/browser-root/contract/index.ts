import type {ComponentValue} from "@immersive/component"
import type {JSX} from "@immersive-jsx-compiler/session"
import type {IntegrationOptions, IntegrationRoot, Presentation} from "@immersive/browser/integration"

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
