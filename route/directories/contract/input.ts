/**
Входной контракт чтения одного уровня видимых директорий.

@property root - Корень package-owned структуры.

@property parent - Читаемая директория внутри `root`.

@property [name] - Единственный запрошенный непосредственный сегмент. Без него
возвращаются все immediate children.

@property [packagePaths] - Известные корни вложенных пакетов, которые принадлежат
workspace composition и не обходятся как обычные директории.

@property [repository] - Ранее определённый Git root одного traversal run.
*/
export interface ReadRouteDirectoriesInput {
  readonly root: string
  readonly parent: string
  readonly name?: string
  readonly packagePaths?: readonly string[]
  readonly repository?: string | null
}
