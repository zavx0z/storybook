import type {ViewPointElement} from "@zavx0z/dom/viewpoint"
import type {TabProps} from "@zavx0z/ui/surface/tab"

export declare namespace WebViewpointControls {
  /** Переданное оболочкой сохранение положения Tab, режима жестов и камеры. */
  export interface Input {
    state: {position: NonNullable<TabProps["position"]>, frozen?: boolean}
    savePosition(position: NonNullable<TabProps["position"]>): void
    restoreCamera(camera: ViewPointElement): void
    saveFrozen(frozen: boolean): void
    saveCamera(camera: ViewPointElement): void
  }

  /** Состояние и команды одной уже существующей камеры. */
  export interface Output {
    readonly initialPosition: NonNullable<TabProps["position"]>
    savePosition(position: NonNullable<TabProps["position"]>): void
    restoreCamera(): void
    getSnapshot(): Readonly<{ready: boolean, frozen: boolean}>
    subscribe(listener: () => void): () => void
    bind(viewPoint: ViewPointElement, fitView: () => void, canSaveCamera?: () => boolean): void
    toggleFrozen(): void
    zoom(factor: number): void
    fit(): void
    dispose(): void
  }
}
