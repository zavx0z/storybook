/**
Разрешает адрес по текущей публичной ветке зарегистрированного пакета.

@packageDocumentation
*/
import {formatRouteAddress} from "./address"
import {readRouteDirectories} from "./directories"
import {readRouteIgnored} from "./ignored"
import type {ResolveRouteInput} from "./contract/input"
import type {ResolveRouteOutput} from "./contract/output"
import {isRouteRootName, parseRoute} from "./src/address"
import {isPublicSegment, readPackageManifest, readRootPath} from "./src/files"
import {readAuthoredStory} from "./src/story"
import {enterWorkspace, readAvailableViews} from "./src/structure"
import type {RoutePosition} from "./src/types"

export type {ResolveRouteInput, ResolveRouteOutput}

/**
Разрешает только одну указанную ветку через `workspaces` и видимые директории.
Функция читает файловую структуру при каждом вызове и не загружает код пакета.

@param input - Пользовательский адрес и зарегистрированные корни.
@returns Канонический узел с физическим владельцем либо `null`.
*/
export async function resolveRoute({route, roots}: ResolveRouteInput): Promise<ResolveRouteOutput> {
  const parsed = parseRoute(route)
  if (parsed === null || parsed.segments.length === 0) return null

  const [rootName, ...segments] = parsed.segments
  if (rootName === undefined) return null
  if (roots.filter(root => root.name === rootName).length !== 1) return null
  const registeredRoot = roots.find(root => root.name === rootName)
  if (registeredRoot === undefined || !isRouteRootName(rootName)) return null

  const rootPath = await readRootPath(registeredRoot.path)
  if (rootPath === null) return null
  const rootManifest = await readPackageManifest(rootPath)
  if (rootManifest === null) return null
  const visibility = await readRouteIgnored({root: rootPath, paths: []}).catch(() => null)
  if (visibility === null) return null
  const {repository} = visibility

  let position: RoutePosition = {
    packageId: rootManifest.name,
    packagePath: rootPath,
    relativeSegments: [],
    directory: rootPath,
    scenarioOwner: true,
    moduleOwner: true,
    stopsTraversal: false,
  }
  let view: NonNullable<ResolveRouteOutput>["view"] = "overview"

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment === undefined) return null
    const manifest = await readPackageManifest(position.packagePath)
    if (manifest === null) return null
    if (position.stopsTraversal) return null

    const workspace = await enterWorkspace(rootPath, position, manifest, segment)
    if (workspace !== null) {
      position = workspace
      continue
    }

    const directories = await readRouteDirectories({
      root: position.packagePath,
      parent: position.directory,
      name: segment,
      repository,
    }).catch(() => null)
    if (directories === null) return null
    const physical = directories.directories.find(directory => directory.name === segment)
    if (physical !== undefined) {
      position = {
        ...position,
        relativeSegments: [...position.relativeSegments, segment],
        directory: physical.path,
        scenarioOwner: physical.module || physical.entry !== null,
        moduleOwner: physical.module,
        stopsTraversal: physical.module,
      }
      continue
    }

    const authoredSegments = [...position.relativeSegments, ...segments.slice(index)]
    if (!authoredSegments.every(isPublicSegment)) return null
    const authoredRoute = authoredSegments.join("/")
    if (parsed.view !== undefined) return null
    const story = await readAuthoredStory(rootPath, position.packagePath, authoredRoute)
    if (story === null) return null
    position = {
      ...position,
      relativeSegments: authoredRoute.split("/"),
      directory: story.directory,
      scenarioOwner: false,
      moduleOwner: false,
      stopsTraversal: true,
    }
    view = "story"
    break
  }

  const availableViews = view === "story"
    ? [] as const
    : await readAvailableViews(
      rootPath,
      position.directory,
      position.scenarioOwner,
      position.moduleOwner,
      repository,
    ).catch(() => null)
  if (availableViews === null) return null
  const views: NonNullable<ResolveRouteOutput>["views"] = availableViews
  if (parsed.view !== undefined) {
    if (!views.includes(parsed.view)) return null
    view = parsed.view
  }

  const node = parsed.segments.join("/")
  const pathname = formatRouteAddress({node})
  return {
    node,
    pathname,
    directory: position.directory,
    package: {id: position.packageId, path: position.packagePath},
    relativePath: position.relativeSegments.join("/"),
    view,
    views,
    ...(parsed.variant === undefined ? {} : {variant: parsed.variant}),
  }
}
