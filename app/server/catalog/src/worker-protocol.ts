import type {AppServerCatalog} from "../contract"
import type {ExternalStorybookAttachSource, ExternalStorybookRegistrySnapshot} from "../contract/models"
import type {RepoDiscovery} from "@repo/discovery"

export type CatalogPreparation = Readonly<{
  snapshot: ExternalStorybookRegistrySnapshot | null
  unchangedPackageIds: readonly string[]
}>

export type CatalogWorkerInput = Readonly<{roots: readonly string[], dirtyScopeRoots?: readonly string[]}> & (
  Readonly<{kind: "prepare", catalog?: RepoDiscovery.Output, previous: ExternalStorybookRegistrySnapshot, sources: readonly ExternalStorybookAttachSource[], styles: ReturnType<NonNullable<AppServerCatalog.Input[1]>>}>
  | Readonly<{kind: "discover", previous?: RepoDiscovery.Output}>
)

export type CatalogWorkerResult = Readonly<{kind: "prepared", result: CatalogPreparation}>
  | Readonly<{kind: "discovered", catalog: RepoDiscovery.Output}>
export type CatalogWorkerMessage = Readonly<{type: "analysis", kind: "contract" | "dependency"}>
  | Readonly<{type: "result", result: CatalogWorkerResult}>
  | Readonly<{type: "failure", message: string}>
