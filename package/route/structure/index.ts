/**
Читает физическую структуру публичного адреса пакета.
Разрешение адресов и перечисление детей используют одни правила обхода и видимости.

@packageDocumentation
*/
/** Читает физическую ветку пакета без построения второго каталога. */
import {readPackageManifest, readRootPath} from "./src/files"
import {enterWorkspace, readAvailableViews, readWorkspaceChildNames} from "./src/structure"
import type {Zavx0zStorybookPackageRouteStructure} from "./contract"

export type {Zavx0zStorybookPackageRouteStructure} from "./contract"

const structure: Zavx0zStorybookPackageRouteStructure.Output = Object.freeze({
  readPackageManifest,
  readRootPath,
  enterWorkspace,
  readAvailableViews,
  readWorkspaceChildNames,
})

export default structure
