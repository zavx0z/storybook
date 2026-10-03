import type {
  Item,
  Group,
  Expansion,
} from "./navigation"
import type {Action, Management} from "./management"

/** Публичные данные и действия общей панели каталога Display и Minimap. */
export declare namespace WebCatalog {
  /**
  Готовый каталог и действия его владельца.

  @property label - Название навигационной области у принимающей поверхности.
  @property search - Текущий поисковый запрос общей модели.
  @property items - Иерархия доступных элементов для этой поверхности.
  @property activeId - Текущая страница; null отключает поиск текущего места.
  @property management - Управление Repo проекта; null убирает его действия.
  @property onAction - Передаёт запрос подключения или удаления владельцу каталога.
  @property onNavigate - Передаёт выбранный элемент и источник события маршрутизации.
  @property onSearch - Публикует новый запрос, включая очистку при поиске текущего места.
  @property onGroupToggle - Сообщает об изменении раскрытия отдельной ветви.
  @property [navigationExpansion] - Восстанавливает и сохраняет раскрытие дерева.
  @property [webRebuild] - Действие пересборки Web в строке поиска Minimap.
  При отсутствии кнопка не показывается; ожидание и ошибка принадлежат вызывающей поверхности.
  */
  export interface Input {
    label: string
    search: string
    items: readonly Item[]
    activeId: string | null
    management: Management | null
    onAction(action: Action, source: HTMLElement): void
    onNavigate(item: Item, source: HTMLElement): void
    onSearch(value: string, source: HTMLElement): void
    onGroupToggle(group: Group, collapsed: boolean, source: HTMLElement): void
    navigationExpansion?: Expansion | undefined
    webRebuild?: Readonly<{
      busy: boolean
      error: string
      onClick(): void
    }> | undefined
  }
}
