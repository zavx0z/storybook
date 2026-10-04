
/** Контракт вывода пакетных build descriptors из единого каталога. */
import {type Zavx0zStorybookPackageMetadataCollect as PackageMetadataCollectContract} from "@zavx0z/storybook-package-metadata-collect"
import {type Zavx0zStorybookPackageGraphCreate as PackageGraphCreateContract} from "@zavx0z/storybook-package-graph-create"
import {type Zavx0zStorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
import type {Zavx0zStorybookPackageRevision} from "@zavx0z/storybook-package-revision"
type StorybookCatalog = PackageMetadataCollectContract.Output
type ExternalStorybookGraph = PackageGraphCreateContract.Output
type Zavx0zStorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
export declare namespace Zavx0zStorybookPackageBuildDescriptor {
  /** Catalog, canonical graph и необязательный набор package ID для отбора. */
  type Input = readonly [
    catalog: StorybookCatalog,
    graph: ExternalStorybookGraph,
    include?: ReadonlySet<string>,
    styles?: NonNullable<Parameters<Zavx0zStorybookPackageRevision.Output["create"]>[3]>,
  ]

  /** Неизменяемый список descriptors для выбранных пакетов каталога. */
  type Output = readonly Zavx0zStorybookPackageBuildDescriptor[]
}
