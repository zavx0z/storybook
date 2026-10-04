import type {ViewPointElement} from "@zavx0z/immersive-dom/viewpoint"
import type {Zavx0zImmersiveUiComponentSurfaceTab} from "@zavx0z/immersive-ui-component"
type TabProps = Zavx0zImmersiveUiComponentSurfaceTab.Input

/** Настройки Tab, режима жестов и сохранённой камеры того же Experience. */
export type CameraState = Pick<ViewPointElement, "x" | "y" | "z" | "targetX" | "targetY" | "targetZ" | "fov" | "near" | "far">
export type SavedState = {
  position: NonNullable<TabProps["position"]>
  frozen?: boolean
  camera?: CameraState
}
