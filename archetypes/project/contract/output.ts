import type {ReadRepoOutput} from "@archetypes/repo"

/**
Композиция ссылок на независимые Repo.

@property repositories - Неповторяющиеся физические Repo со своими пакетными identity.
@property duplicateNames - Разные физические корни с одинаковой пакетной identity.
@property nestedRoots - Выбранные Repo, физически вложенные в другой выбранный Repo.
*/
export interface ReadProjectOutput {
  readonly repositories: readonly ReadRepoOutput[]
  readonly duplicateNames: readonly string[]
  readonly nestedRoots: readonly string[]
}
