import type {MinimapState} from "../src/state.ts"
import type {CatalogPanelProps} from "../../catalog-panel/contract/input.ts"

/**
Дерево навигации в HUD, которое пользователь сворачивает в Tab.

@property catalog - Те же данные и действия каталога, что использует Display.
Поиск и выбор принадлежат Workbench; скрытие сохраняет экземпляр дерева.

@property [initialState] - Восстановленные видимость, геометрия окна и положение Tab.
Без значения окно открыто в начальной раскладке. Применяется при создании компонента.

@property [onStateChange] - Сохраняет новый снимок при переключении видимости и завершении
перемещения окна, resize или перетаскивания Tab. Промежуточные и отменённые жесты не публикуются.

@property [onRebuildWeb] - Явно пересобирает интерфейс Storybook через операцию приложения.
Наличие callback показывает кнопку со значком рядом с действиями дерева в строке поиска.
До завершения Promise повторное нажатие блокируется;
отказ показывается в окне и позволяет повторить попытку. Завершение подготовки не означает
подтверждения применения новой версии во всех представлениях.
*/
export interface MinimapProps {
  readonly catalog: CatalogPanelProps
  readonly initialState?: MinimapState | undefined
  readonly onStateChange?: ((state: MinimapState) => void) | undefined
  readonly onRebuildWeb?: (() => Promise<void>) | undefined
}
