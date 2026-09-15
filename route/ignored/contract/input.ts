/**
Входной контракт проверки Git exclusions.

@property root - Корень package-owned структуры.

@property paths - Проверяемые пути внутри `root`, включая ещё не созданные markers.

@property [repository] - Ранее определённый Git root для повторного вызова;
`null` явно обозначает отсутствие Git repository.
*/
export interface ReadRouteIgnoredInput {
  readonly root: string
  readonly paths: readonly string[]
  readonly repository?: string | null
}
