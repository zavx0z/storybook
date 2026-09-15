/**
Читает один уровень публичных структурных маршрутов без построения полного дерева.

@packageDocumentation
*/
import {resolveRoute} from ".."
import {readRouteDirectories} from "../directories"
import {readRouteIgnored} from "../ignored"
import type {ReadRouteChildrenInput} from "./contract/input"
import type {ReadRouteChildrenOutput} from "./contract/output"
import {parseRoute} from "../src/address"
import {readPackageManifest} from "../src/files"
import {readWorkspaceChildNames} from "../src/structure"
import {basename, dirname} from "node:path"
import {resolveImmediateChildren} from "./src/resolve"

export type {ReadRouteChildrenInput, ReadRouteChildrenOutput}

/**
Возвращает зарегистрированные корни либо непосредственных детей выбранного overview.
Каждый ребёнок заново проходит полный resolver, поэтому результат отражает текущее
состояние файловой системы.

@param input - Адрес родителя и зарегистрированные корни.
@returns Разрешённые непосредственные маршруты.
*/
export async function readRouteChildren({route, roots}: ReadRouteChildrenInput): Promise<ReadRouteChildrenOutput> {
  const parsed = parseRoute(route)
  if (parsed === null || parsed.variant !== undefined || parsed.view !== undefined) return []
  if (parsed.segments.length === 0) {
    return resolveImmediateChildren(roots.map(root => root.name), "", roots)
  }

  const parent = await resolveRoute({route, roots})
  if (parent === null || parent.view !== "overview") return []
  const manifest = await readPackageManifest(parent.package.path)
  if (manifest === null) return []
  const visibility = await readRouteIgnored({root: parent.package.path, paths: []}).catch(() => null)
  if (visibility === null) return []
  const {repository} = visibility

  if (parent.relativePath !== "") {
    const ownerDirectories = await readRouteDirectories({
      root: parent.package.path,
      parent: dirname(parent.directory),
      name: basename(parent.directory),
      repository,
    }).catch(() => null)
    if (ownerDirectories === null) return []
    const descriptor = ownerDirectories.directories.find(directory => directory.path === parent.directory)
    if (descriptor?.module === true) return []
  }

  const position = {
    packageId: parent.package.id,
    packagePath: parent.package.path,
    relativeSegments: parent.relativePath === "" ? [] : parent.relativePath.split("/"),
    directory: parent.directory,
    scenarioOwner: false,
    moduleOwner: false,
    stopsTraversal: false,
  }
  const names = new Set(readWorkspaceChildNames(position, manifest))
  const directories = await readRouteDirectories({
    root: parent.package.path,
    parent: parent.directory,
    repository,
  }).catch(() => null)
  if (directories === null) return []
  for (const directory of directories.directories) names.add(directory.name)
  return resolveImmediateChildren([...names], parent.node, roots)
}
