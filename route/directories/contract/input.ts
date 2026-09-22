/**
Условия чтения одного уровня видимых директорий пакета.

@property root - Корень структуры, принадлежащей пакету.

@property parent - Читаемая директория внутри `root`.

@property [name] - Имя одной запрошенной непосредственной поддиректории.
Без него возвращаются все видимые непосредственные поддиректории.

@property [packagePaths] - Известные корни вложенных пакетов из состава рабочего
пространства. Они не обходятся как обычные директории текущего пакета.

@property [repository] - Ранее определённый корень Git-репозитория для этого обхода.
*/
export interface ReadRouteDirectoriesInput {
  readonly root: string
  readonly parent: string
  readonly name?: string
  readonly packagePaths?: readonly string[]
  readonly repository?: string | null
}
