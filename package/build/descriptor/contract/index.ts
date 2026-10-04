
/** Контракт вывода пакетных build descriptors из единого каталога. */
import {type StorybookPackageMetadataCollect as PackageMetadataCollectContract} from "@zavx0z/storybook-package-metadata-collect"
import {type StorybookPackageGraphCreate as PackageGraphCreateContract} from "@zavx0z/storybook-package-graph-create"
import {type StorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
import type {StorybookPackageRevision} from "@zavx0z/storybook-package-revision"
type StorybookCatalog = PackageMetadataCollectContract.Output
type ExternalStorybookGraph = PackageGraphCreateContract.Output
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
export declare namespace StorybookPackageBuildDescriptor {
  /** Catalog, canonical graph и необязательный набор package ID для отбора. */
  type Input = readonly [
    catalog: StorybookCatalog,
    graph: ExternalStorybookGraph,
    include?: ReadonlySet<string>,
    styles?: NonNullable<Parameters<StorybookPackageRevision.Output["create"]>[3]>,
  ]

  /** Неизменяемый список descriptors для выбранных пакетов каталога. */
  type Output = readonly StorybookPackageBuildDescriptor[]
}
