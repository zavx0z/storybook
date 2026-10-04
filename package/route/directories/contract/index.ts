/** Контракт чтения видимых непосредственных директорий пакета. */
export declare namespace Zavx0zStorybookPackageRouteDirectories {
  /** Корень, родитель и необязательные границы известного workspace. */
  type Input = Readonly<{
    root: string
    parent: string
    name?: string
    packagePaths?: readonly string[]
    repository?: string | null
  }>

  /** Директории с ближайшей границей модуля и влияющие файлы. */
  type Output = Readonly<{
    directories: readonly Readonly<{
      name: string
      path: string
      entry: "tsx" | "ts" | null
      module: boolean
    }>[]
    inputs: readonly string[]
  }>
}
