import type {Zavx0zStorybookAppServerCatalog} from "../contract"
import type {ExternalStorybookAttachSource, ExternalStorybookRegistrySnapshot} from "../contract/models"
import type {Zavx0zStorybookRepoDiscovery} from "@zavx0z/storybook-repo-discovery"

export type CatalogPreparation = Readonly<{
  snapshot: ExternalStorybookRegistrySnapshot | null
  unchangedPackageIds: readonly string[]
}>

export type CatalogWorkerInput = Readonly<{roots: readonly string[], dirtyScopeRoots?: readonly string[]}> & (
  Readonly<{kind: "prepare", catalog?: Zavx0zStorybookRepoDiscovery.Output, previous: ExternalStorybookRegistrySnapshot, sources: readonly ExternalStorybookAttachSource[], styles: ReturnType<NonNullable<Zavx0zStorybookAppServerCatalog.Input[1]>>}>
  | Readonly<{kind: "discover", previous?: Zavx0zStorybookRepoDiscovery.Output}>
)

export type CatalogWorkerResult = Readonly<{kind: "prepared", result: CatalogPreparation}>
  | Readonly<{kind: "discovered", catalog: Zavx0zStorybookRepoDiscovery.Output}>
export type CatalogWorkerMessage = Readonly<{type: "analysis", kind: "contract" | "dependency"}>
  | Readonly<{type: "result", result: CatalogWorkerResult}>
  | Readonly<{type: "failure", message: string}>
