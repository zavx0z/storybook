import type {StorybookRepoDiscovery} from "@storybook-repo/discovery"
import type {StorybookPackageGraphCreate} from "@storybook-package-graph/create"
import type {StorybookPackageSession} from "@storybook-package/session"
type StorybookCatalog = StorybookRepoDiscovery.Output
type ExternalStorybookGraph = StorybookPackageGraphCreate.Output
type StorybookPackageBuildDescriptor = StorybookPackageSession.Input[0]

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
  descriptors: readonly StorybookPackageBuildDescriptor[]
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
