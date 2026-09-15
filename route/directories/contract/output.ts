/**
Видимые непосредственные директории и пути, влияющие на их структурную границу.

@property directories - Immediate descriptors. `name` и `path` обозначают
физический сегмент; `entry` выбирает видимый index; `module` завершает traversal.

@property watchPaths - Директории, `.gitignore`, package, entry и source markers,
изменение которых требует повторного чтения.
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
