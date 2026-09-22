/**
Условия проверки путей по правилам исключения Git.

@property root - Корень структуры, принадлежащей пакету.

@property paths - Проверяемые пути внутри `root`, включая ещё не созданные файлы,
по которым определяется структура.

@property [repository] - Ранее определённый корень Git-репозитория для повторного
вызова. `null` явно обозначает отсутствие Git-репозитория.
*/
export interface ReadRouteIgnoredInput {
  readonly root: string
  readonly paths: readonly string[]
  readonly repository?: string | null
}
