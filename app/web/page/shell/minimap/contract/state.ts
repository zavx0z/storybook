import type {WindowGeometry} from "@zavx0z/ui/surface/window"
import type {TabProps} from "@zavx0z/ui/surface/tab"

/** Частичные поля сохранённой раскладки; проверка значений принадлежит Minimap. */
export type MinimapInitialState = Readonly<{
  collapsed?: boolean
  geometry?: Partial<WindowGeometry>
  tab?: Partial<NonNullable<TabProps["position"]>>
}>
