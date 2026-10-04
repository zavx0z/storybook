import type {Zavx0zImmersiveUiComponentSurfaceWindow} from "@zavx0z/immersive-ui-component"
type WindowGeometry = NonNullable<Zavx0zImmersiveUiComponentSurfaceWindow.Input["geometry"]>
import type {Zavx0zImmersiveUiComponentSurfaceTab} from "@zavx0z/immersive-ui-component"
type TabProps = Zavx0zImmersiveUiComponentSurfaceTab.Input

/** Частичные поля сохранённой раскладки; проверка значений принадлежит Minimap. */
export type MinimapInitialState = Readonly<{
  collapsed?: boolean
  geometry?: Partial<WindowGeometry>
  tab?: Partial<NonNullable<TabProps["position"]>>
}>
