import type {MinimapState} from "@minimap/state"
import type {WebCatalog} from "@web/catalog"

export declare namespace WebMinimap {
  /**
  Дерево навигации в HUD, которое пользователь сворачивает в Tab.

  @property projectName - Имя Project, общее для заголовка окна и управляющего Tab.

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
  export interface Input {
    readonly projectName: string
    readonly catalog: WebCatalog.Input
    readonly initialState?: MinimapState.Output | undefined
    readonly onStateChange?: ((state: MinimapState.Output) => void) | undefined
    readonly onRebuildWeb?: (() => Promise<void>) | undefined
  }
}
