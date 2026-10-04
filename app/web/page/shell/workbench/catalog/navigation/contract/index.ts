import type {Item} from "./navigation"
import type {NavigationProjection} from "./projection"

export declare namespace Zavx0zStorybookAppWebPageShellWorkbenchCatalogNavigation {
  /** Проверка структурных данных и чистая проекция того же каталога без создания DOM. */
  export type Output = Readonly<{
    /** Проверяет форму и связи узлов до передачи в модель или отрисовку. */
    normalizeItems(label: string, value: unknown): readonly Item[]
    /** Сохраняет предков поисковых совпадений и закрытые ветви без изменения исходного списка. */
    projectNavigation(items: readonly Item[], query: string, collapsedGroupIds: ReadonlySet<string>): NavigationProjection
  }>
}
