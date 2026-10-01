import type {WorkbenchNavigationGroup, WorkbenchNavigationItem, WorkbenchCatalogAction, WorkbenchCatalogManagement} from "../../contract.ts"
import type {NavigationExpansion} from "../../navigation/persistence.ts"

/**
Данные и действия единого каталога; маршруты и управление пакетами принадлежат Workbench.

@property label - Название навигационной области у принимающей поверхности.
@property search - Текущий поисковый запрос общей модели.
@property items - Полная иерархия доступных элементов каталога.
@property activeId - Текущая страница; null отключает поиск текущего места.
@property management - Управление подключёнными проектами; null убирает его действия.
@property onAction - Передаёт запрос подключения или удаления владельцу каталога.
@property onNavigate - Передаёт выбранный элемент и источник события маршрутизации.
@property onSearch - Публикует новый запрос, включая очистку при поиске текущего места.
@property onGroupToggle - Сообщает об изменении раскрытия отдельной ветви.
@property [navigationExpansion] - Восстанавливает и сохраняет раскрытие дерева.
@property [webRebuild] - Действие пересборки Web в строке поиска Minimap.
При отсутствии кнопка не показывается; ожидание и ошибка принадлежат вызывающей поверхности.
*/
export interface CatalogPanelProps {
  label: string
  search: string
  items: readonly WorkbenchNavigationItem[]
  activeId: string | null
  management: WorkbenchCatalogManagement | null
  onAction(action: WorkbenchCatalogAction, source: HTMLElement): void
  onNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
  onSearch(value: string, source: HTMLElement): void
  onGroupToggle(group: WorkbenchNavigationGroup, collapsed: boolean, source: HTMLElement): void
  navigationExpansion?: NavigationExpansion | undefined
  webRebuild?: Readonly<{
    busy: boolean
    error: string
    onClick(): void
  }> | undefined
}
