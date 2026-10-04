import {type StorybookPackageGraphCreate as PackageGraphCreateContract} from "@zavx0z/storybook-package-graph-create"
type ExternalStorybookGraph = PackageGraphCreateContract.Output
import type {
  StorybookAuthorStyleSheetSource,
  StorybookPackageRevisionGraphSnapshot,
} from "./types"

export declare namespace StorybookPackageRevision {
  /** Создание, проверка и адресация ресурсов одной пакетной ревизии. */
  type Output = Readonly<{
    protocol: StorybookPackageRevisionGraphSnapshot["protocol"]
    create(graph: ExternalStorybookGraph, packageId: string, declarationDigest: string, workbenchStyles?: readonly StorybookAuthorStyleSheetSource[]): StorybookPackageRevisionGraphSnapshot
    validate(value: StorybookPackageRevisionGraphSnapshot, expectedPackageId?: string): StorybookPackageRevisionGraphSnapshot
    nodeResourcePrefix(nodeId: string): string
    moduleDocumentationPath(nodeId: string): string
    workbenchAuthorStyleSheetPath(index: number): string
  }>
}
