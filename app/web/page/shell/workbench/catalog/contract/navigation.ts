import type {StorybookAppWebPageShellWorkbenchCatalogNavigation} from "@storybook-app-web-page-shell-workbench-catalog/navigation"

/** Узел публичной навигационной модели дочернего владельца. */
export type Item = ReturnType<StorybookAppWebPageShellWorkbenchCatalogNavigation.Output["normalizeItems"]>[number]

/** Та же группа раскрытия, которую содержит навигационный узел. */
export type Group = NonNullable<Item["group"]>

/**
Восстановление и сохранение закрытых ветвей без зависимости панели от хранилища.
Фокус, поиск и выбранная страница не входят в этот порт.
*/
export type Expansion = Readonly<{
  /** Отсутствие сохранённого состояния отличается от явно раскрытого дерева с пустым списком. */
  initialCollapsedIds?: readonly string[] | undefined
  save(collapsedIds: readonly string[]): void
}>
