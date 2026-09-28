import type {CatalogPanelProps} from "../../catalog-panel/contract/input.ts"

/**
Дерево навигации в HUD, которое пользователь сворачивает в Tab.

@property catalog - Те же данные и действия каталога, что использует Display.
Поиск и выбор принадлежат Workbench; скрытие сохраняет экземпляр дерева.

@property [initialCollapsed=false] - Начальная видимость: true показывает Tab,
false раскрывает панель. Последующее переключение принадлежит Minimap.
*/
export interface MinimapProps {
  readonly catalog: CatalogPanelProps
  readonly initialCollapsed?: boolean | undefined
}
