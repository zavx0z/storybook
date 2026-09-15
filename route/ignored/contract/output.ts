/**
Результат native Git ignore query и пути, влияющие на его правила.

@property ignored - Переданные пути, исключённые действующими `.gitignore`.

@property repository - Реальный Git root либо `null` вне repository.

@property watchPaths - `.gitignore` от package root до Git root включительно.
*/
export type ReadRouteIgnoredOutput = {
  readonly ignored: readonly string[]
  readonly repository: string | null
  readonly watchPaths: readonly string[]
}
