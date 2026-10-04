/** Контракт чтения физического состава workspaces Repo. */
export declare namespace StorybookPackageRouteWorkspaces {
  /** Корень владельца и необязательное значение package.json#workspaces. */
  type Input = Readonly<{root: string; value?: unknown}>

  /** Канонические корни вложенных пакетов и файлы, влияющие на состав. */
  type Output = Readonly<{roots: readonly string[]; inputs: readonly string[]}>
}
