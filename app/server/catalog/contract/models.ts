import type {Zavx0zStorybookRepoDiscovery} from "@zavx0z/storybook-repo-discovery"
import type {Zavx0zStorybookPackageGraphCreate} from "@zavx0z/storybook-package-graph-create"
import type {Zavx0zStorybookPackageSession} from "@zavx0z/storybook-package-session"
type StorybookCatalog = Zavx0zStorybookRepoDiscovery.Output
type ExternalStorybookGraph = Zavx0zStorybookPackageGraphCreate.Output
type Zavx0zStorybookPackageBuildDescriptor = Zavx0zStorybookPackageSession.Input[0]

export type ExternalStorybookAttachSource = "cli" | "direct-package"

export type ExternalStorybookRegistryEntry = Readonly<{
  declarationPath: string
  rootKind: "package" | "unavailable"
  canonicalId: string
  digest: string
  descendantIds: readonly string[]
  attachSource: ExternalStorybookAttachSource
}>

export type ExternalStorybookRegistrySnapshot = Readonly<{
  revision: number
  entries: readonly ExternalStorybookRegistryEntry[]
  catalog: StorybookCatalog
  graph: ExternalStorybookGraph
  descriptors: readonly Zavx0zStorybookPackageBuildDescriptor[]
}>

/** Текущая причина следующего условного обновления реестра. */
export type ExternalStorybookRegistryDirtySnapshot = Readonly<{
  dirty: boolean
  paths: readonly string[]
  scopeRoots: readonly string[]
}>

/** Счётчики работы реестра без смешивания с общей длительностью операции. */
export type ExternalStorybookRegistryMetrics = Readonly<{
  refreshing: boolean
  resolverCalls: number
  graphRebuilds: number
  cacheHits: number
  typescriptApiSessions: Readonly<{
    contract: number
    dependency: number
    total: number
  }>
}>
