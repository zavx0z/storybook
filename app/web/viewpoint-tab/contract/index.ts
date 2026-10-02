import type {WebViewpointControls} from "@web/viewpoint-controls"

export declare namespace WebViewpointTab {
  /** Команды ViewPoint существующего Browser Root без создания новой камеры. */
  export interface Input {
    readonly controls: WebViewpointControls.Output
  }
}
