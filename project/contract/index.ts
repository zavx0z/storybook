import type {ArchetypesRepo} from "@archetypes/repo"

export declare namespace ArchetypesProject {
  /**
  Выбранные независимые Repo проекта. Project не обязан иметь собственный Git-корень.

  @property paths - Физические корни пакетов-репозиториев; повторная ссылка не создаёт копию Repo.
  */
  export interface Input {
    readonly paths: readonly string[]
  }

  /**
  Композиция ссылок на независимые Repo.

  @property repositories - Неповторяющиеся физические Repo со своими пакетными identity.
  @property duplicateNames - Разные физические корни с одинаковой пакетной identity.
  @property nestedRoots - Выбранные Repo, физически вложенные в другой выбранный Repo.
  */
  export interface Output {
    readonly repositories: readonly ArchetypesRepo.Output[]
    readonly duplicateNames: readonly string[]
    readonly nestedRoots: readonly string[]
  }
}
