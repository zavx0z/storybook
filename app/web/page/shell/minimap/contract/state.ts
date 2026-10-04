import type {ImmersiveUiComponentSurfaceWindow} from "@zavx0z/immersive-ui-component"
type WindowGeometry = NonNullable<ImmersiveUiComponentSurfaceWindow.Input["geometry"]>
import type {ImmersiveUiComponentSurfaceTab} from "@zavx0z/immersive-ui-component"
type TabProps = ImmersiveUiComponentSurfaceTab.Input

/** Частичные поля сохранённой раскладки; проверка значений принадлежит Minimap. */
export type MinimapInitialState = Readonly<{
  collapsed?: boolean
  geometry?: Partial<WindowGeometry>
  tab?: Partial<NonNullable<TabProps["position"]>>
}>
