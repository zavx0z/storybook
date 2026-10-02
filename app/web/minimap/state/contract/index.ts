import type {WindowGeometry} from "@zavx0z/ui/surface/window"
import type {TabProps} from "@zavx0z/ui/surface/tab"

export declare namespace MinimapState {
  /** Настройки Minimap между сессиями; данные каталога и временный pointer-жест сюда не входят. */
  export interface Output {
    readonly collapsed: boolean
    readonly geometry: WindowGeometry
    readonly tab: NonNullable<TabProps["position"]>
  }
}
