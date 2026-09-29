/**
Выбранные независимые Repo проекта. Project не обязан иметь собственный Git-корень.

@property paths - Физические корни пакетов-репозиториев; повторная ссылка не создаёт копию Repo.
*/
export interface ReadProjectInput {
  readonly paths: readonly string[]
}
