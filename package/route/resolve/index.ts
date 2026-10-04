/**
Разрешает адрес по текущей публичной ветке зарегистрированного пакета.

@packageDocumentation
*/
import address from "@zavx0z/storybook-package-route-address"
import readRouteDirectories from "@zavx0z/storybook-package-route-directories"
import readRouteIgnored from "@zavx0z/storybook-package-route-ignored"
import structure, {type Zavx0zStorybookPackageRouteStructure} from "@zavx0z/storybook-package-route-structure"
import readPackageJson from "@zavx0z/storybook-package-package-json"
import readPackageIndex from "@zavx0z/storybook-package-index"
import readContract from "@zavx0z/storybook-contracts"
import {join, resolve} from "node:path"
import type {Zavx0zStorybookPackageRouteResolve} from "./contract"

export type {Zavx0zStorybookPackageRouteResolve} from "./contract"

const {parseRoute, isRouteRootName} = address
const {readPackageManifest, readRootPath, enterWorkspace, readAvailableViews} = structure
type RoutePosition = NonNullable<Awaited<ReturnType<Zavx0zStorybookPackageRouteStructure.Output["enterWorkspace"]>>>

/**
Разрешает только одну указанную ветку через `workspaces` и видимые директории.
Функция читает файловую структуру при каждом вызове и не загружает код пакета.

@param input - Пользовательский адрес и зарегистрированные корни.
@returns Канонический узел с физическим владельцем либо `null`.
*/
export default async function resolveRoute({route, roots}: Zavx0zStorybookPackageRouteResolve.Input): Promise<Zavx0zStorybookPackageRouteResolve.Output> {
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
  let view: NonNullable<Zavx0zStorybookPackageRouteResolve.Output>["view"] = "overview"
  let entryPath: string | undefined

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

    if (index === segments.length - 1 && position.directory === position.packagePath && /\.[cm]?[jt]sx?$/u.test(segment)) {
      const metadata = await readPackageJson({path: join(position.packagePath, "package.json")}).catch(() => null)
      if (metadata === null) return null
      const entries = await readPackageIndex({path: position.packagePath, exports: metadata.exports}).catch(() => null)
      const target = entries?.entries.find(entry => entry.path === "." && entry.status === "owned" && entry.code
        && entry.target !== null && resolve(position.packagePath, entry.target) === join(position.directory, segment))
      if (target) {
        const path = resolve(position.packagePath, target.target!)
        if ((await readRouteIgnored({root: position.packagePath, paths: [path], repository})).ignored.length) return null
        entryPath = path
        position = {...position, relativeSegments: [...position.relativeSegments, segment]}
        continue
      }
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
        moduleOwner: physical.module || physical.entry !== null,
        stopsTraversal: physical.module,
      }
      continue
    }

    return null
  }

  const availableViews = entryPath === undefined ? await readAvailableViews(
    rootPath,
    position.directory,
    position.scenarioOwner,
    position.moduleOwner,
    repository,
  ).catch(() => null) : await readContract({path: position.packagePath}).then(contract =>
    contract.entries.some(entry => entry.path === entryPath && entry.namespaces.length > 0) ? ["contract" as const] : []).catch(() => null)
  if (availableViews === null) return null
  const views: NonNullable<Zavx0zStorybookPackageRouteResolve.Output>["views"] = availableViews
  if (parsed.view !== undefined) {
    if (!views.includes(parsed.view)) return null
    view = parsed.view
  }

  const node = parsed.segments.join("/")
  const pathname = address({node})
  return {
    node,
    pathname,
    directory: position.directory,
    ...(entryPath === undefined ? {} : {entry: entryPath}),
    package: {id: position.packageId, path: position.packagePath},
    relativePath: position.relativeSegments.join("/"),
    view,
    views,
    ...(parsed.variant === undefined ? {} : {variant: parsed.variant}),
  }
}
