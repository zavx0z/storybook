import type {StorybookAppWebPageShellViewpointControls} from "@storybook-app-web-page-shell/viewpoint-controls"

export declare namespace StorybookAppWebPageShellViewpointTab {
  /** Команды ViewPoint существующего Browser Root без создания новой камеры. */
  export interface Input {
    readonly controls: StorybookAppWebPageShellViewpointControls.Output
  }
}
