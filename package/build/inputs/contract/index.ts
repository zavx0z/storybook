
/** Контракт физических входов и идентичности пакетной сборки. */
import {type Zavx0zStorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
type Zavx0zStorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
export declare namespace Zavx0zStorybookPackageBuildInputs {
  /**
  Канонизация списка source paths и проверка принадлежности пакета.

  @property canonicalBuildInputs - Разрешает существующие файлы metafile
  относительно корня Repo и cwd, возвращая отсортированные реальные пути.

  @property stablePath - Сохраняет реальную директорию файла и его исходное имя.

  @property validateConsumerBoundary - Проверяет, что код подключённого пакета
  не импортирует внешний Storybook; нарушение вызывает ошибку сборки.

  @property canonicalizeIdentities - Сводит package identity к одному
  реальному владельцу или отклоняет несовместимые пути.
  */
  type Output = Readonly<{
    canonicalBuildInputs(inputs: Readonly<Record<string, unknown>>, repo: string): readonly string[]
    stablePath(path: string): string
    validateConsumerBoundary(paths: readonly string[], descriptor: Zavx0zStorybookPackageBuildDescriptor, stagingDirectory: string): void
    canonicalizeIdentities(paths: readonly string[]): readonly string[]
  }>
}
