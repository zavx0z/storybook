/**
Результат проверки исключений средствами Git и пути к влияющим на неё правилам.

@property ignored - Переданные пути, исключённые действующими правилами `.gitignore`.

@property repository - Фактический корень Git-репозитория либо `null` вне репозитория.

@property inputs - Файлы `.gitignore` от корня пакета до корня Git-репозитория
включительно.
*/
export type ReadRouteIgnoredOutput = {
  readonly ignored: readonly string[]
  readonly repository: string | null
  readonly inputs: readonly string[]
}
