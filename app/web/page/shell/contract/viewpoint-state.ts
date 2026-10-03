import type {ViewPointElement} from "@zavx0z/dom/viewpoint"
import type {UiSurfacesTab} from "@zavx0z/ui/surface/tab"
type TabProps = UiSurfacesTab.Input

/** Настройки Tab, режима жестов и сохранённой камеры того же Experience. */
export type CameraState = Pick<ViewPointElement, "x" | "y" | "z" | "targetX" | "targetY" | "targetZ" | "fov" | "near" | "far">
export type SavedState = {
  position: NonNullable<TabProps["position"]>
  frozen?: boolean
  camera?: CameraState
}
