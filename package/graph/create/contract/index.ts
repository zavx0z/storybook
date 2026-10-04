import type {Zavx0zStorybookPackageMetadataCollect} from "@zavx0z/storybook-package-metadata-collect"
import type {GraphNode} from "./graph"

/** Контракт детерминированного графа физического каталога Repo. */
export declare namespace Zavx0zStorybookPackageGraphCreate {
  /** Сырой каталог с версией 1 без состояния реестра. */
  type Input = Zavx0zStorybookPackageMetadataCollect.Output

  /** Узлы, корни и digest одной проверенной структурной ревизии. */
  type Output = Readonly<{
    schemaVersion: 1
    rootIds: readonly string[]
    nodes: readonly GraphNode[]
    digest: string
  }>
}
