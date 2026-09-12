/**
Входной контракт чтения package.json.

@property path - Путь к самому файлу package.json.
*/
export interface ReadPackageJsonInput {
  readonly path: string
}
