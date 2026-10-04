/**
Читает физическую структуру публичного адреса пакета.
Разрешение адресов и перечисление детей используют одни правила обхода и видимости.

@packageDocumentation
*/
/** Читает физическую ветку пакета без построения второго каталога. */
import {readPackageManifest, readRootPath} from "./src/files"
import {enterWorkspace, readAvailableViews, readWorkspaceChildNames} from "./src/structure"
import type {StorybookPackageRouteStructure} from "./contract"

export type {StorybookPackageRouteStructure} from "./contract"

const structure: StorybookPackageRouteStructure.Output = Object.freeze({
  readPackageManifest,
  readRootPath,
  enterWorkspace,
  readAvailableViews,
  readWorkspaceChildNames,
})

export default structure
