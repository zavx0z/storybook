import type {StorybookAppServerCatalog} from "../contract"
import type {ExternalStorybookAttachSource, ExternalStorybookRegistrySnapshot} from "../contract/models"
import type {StorybookRepoDiscovery} from "@storybook-repo/discovery"

export type CatalogPreparation = Readonly<{
  snapshot: ExternalStorybookRegistrySnapshot | null
  unchangedPackageIds: readonly string[]
}>

export type CatalogWorkerInput = Readonly<{roots: readonly string[], dirtyScopeRoots?: readonly string[]}> & (
  Readonly<{kind: "prepare", catalog?: StorybookRepoDiscovery.Output, previous: ExternalStorybookRegistrySnapshot, sources: readonly ExternalStorybookAttachSource[], styles: ReturnType<NonNullable<StorybookAppServerCatalog.Input[1]>>}>
  | Readonly<{kind: "discover", previous?: StorybookRepoDiscovery.Output}>
)

export type CatalogWorkerResult = Readonly<{kind: "prepared", result: CatalogPreparation}>
  | Readonly<{kind: "discovered", catalog: StorybookRepoDiscovery.Output}>
export type CatalogWorkerMessage = Readonly<{type: "analysis", kind: "contract" | "dependency"}>
  | Readonly<{type: "result", result: CatalogWorkerResult}>
  | Readonly<{type: "failure", message: string}>
