/**
Видимые непосредственные директории и пути, влияющие на их структурную границу.

@property directories - Описания поддиректорий: `name` и `path` обозначают имя
и физический путь; `entry` — видимый вход `index.tsx`, `index.ts` либо его отсутствие;
`module` обозначает модуль, на котором дальнейший структурный обход завершается.

@property watchPaths - Директории, файлы `.gitignore`, манифесты пакетов,
входные файлы и признаки исходников, изменение которых требует повторного чтения.
*/
export type ReadRouteDirectoriesOutput = {
  readonly directories: readonly {
    readonly name: string
    readonly path: string
    readonly entry: "tsx" | "ts" | null
    readonly module: boolean
  }[]
  readonly watchPaths: readonly string[]
}
