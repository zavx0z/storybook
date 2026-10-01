
/** Контракт вывода пакетных build descriptors из единого каталога. */
import {type RepoDiscovery as RepoDiscoveryContract} from "@repo/discovery"
import {type PackageGraphCreate as PackageGraphCreateContract} from "@package-graph/create"
import {type PackageSession as PackageSessionContract} from "@package/session"
import type {PackageRevision} from "@package/revision"
type StorybookCatalog = RepoDiscoveryContract.Output
type ExternalStorybookGraph = PackageGraphCreateContract.Output
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
export declare namespace PackageBuildDescriptor {
  /** Catalog, canonical graph и необязательный набор package ID для отбора. */
  type Input = readonly [
    catalog: StorybookCatalog,
    graph: ExternalStorybookGraph,
    include?: ReadonlySet<string>,
    styles?: NonNullable<Parameters<PackageRevision.Output["create"]>[3]>,
  ]

  /** Неизменяемый список descriptors для выбранных пакетов каталога. */
  type Output = readonly StorybookPackageBuildDescriptor[]
}
