import type {StorybookAppWebPageShellViewpointControls} from "@zavx0z/storybook-app-web-page-shell-viewpoint-controls"

export declare namespace StorybookAppWebPageShellViewpointTab {
  /** Команды ViewPoint существующего Browser Root без создания новой камеры. */
  export interface Input {
    readonly controls: StorybookAppWebPageShellViewpointControls.Output
    /** Политика следования workspace; операции камеры остаются у controls. */
    readonly followEnvironment: Readonly<{
      getSnapshot(): boolean
      subscribe(listener: () => void): () => void
      toggle(): void
    }>
  }
}
