import type {CatalogNavigation} from "@catalog/navigation"

/** Узел публичной навигационной модели дочернего владельца. */
export type Item = ReturnType<CatalogNavigation.Output["normalizeItems"]>[number]

/** Та же группа раскрытия, которую содержит навигационный узел. */
export type Group = NonNullable<Item["group"]>

/**
Восстановление и сохранение закрытых ветвей без зависимости панели от хранилища.
Фокус, поиск и выбранная страница не входят в этот порт.
*/
export type Expansion = Readonly<{
  initialCollapsedIds: readonly string[]
  save(collapsedIds: readonly string[]): void
}>
