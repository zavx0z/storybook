import type {Zavx0zStorybookAppServerCatalog} from "../contract"
import type {ExternalStorybookAttachSource, ExternalStorybookRegistrySnapshot} from "../contract/models"
import type {Zavx0zStorybookPackageMetadataCollect} from "@zavx0z/storybook-package-metadata-collect"

export type CatalogPreparation = Readonly<{
  snapshot: ExternalStorybookRegistrySnapshot | null
  unchangedPackageIds: readonly string[]
}>

export type CatalogWorkerInput = (Readonly<{roots: readonly string[], dirtyScopeRoots?: readonly string[]}> & (
  Readonly<{kind: "prepare", catalog?: Zavx0zStorybookPackageMetadataCollect.Output, previous: ExternalStorybookRegistrySnapshot, sources: readonly ExternalStorybookAttachSource[], styles: ReturnType<NonNullable<Zavx0zStorybookAppServerCatalog.Input[1]>>}>
  | Readonly<{kind: "discover", previous?: Zavx0zStorybookPackageMetadataCollect.Output}>
)) | Readonly<{kind: "save-metadata", project: Readonly<{root: string, name: string}>, snapshot: ExternalStorybookRegistrySnapshot}>
  | (Readonly<{project: Readonly<{root: string, name: string}>, roots: readonly string[],
      sources: readonly ExternalStorybookAttachSource[], dirtyScopeRoots?: readonly string[],
      styles: ReturnType<NonNullable<Zavx0zStorybookAppServerCatalog.Input[1]>>}>
      & (Readonly<{kind: "open-files"}> | Readonly<{kind: "refresh-files"}>))
  | Readonly<{kind: "rename-files", project: Readonly<{root: string, name: string}>}>

export type CatalogWorkerResult = Readonly<{kind: "prepared", result: CatalogPreparation}>
  | Readonly<{kind: "discovered", catalog: Zavx0zStorybookPackageMetadataCollect.Output}>
  | Readonly<{kind: "metadata-saved", result: Readonly<{owners: number, changed: number}>}>
  | Readonly<{kind: "files-ready", discovered: boolean, graphChanged: boolean}>
export type CatalogWorkerMessage = Readonly<{type: "analysis", kind: "contract" | "dependency"}>
  | Readonly<{type: "result", result: CatalogWorkerResult}>
  | Readonly<{type: "failure", message: string}>
