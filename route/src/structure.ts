import {resolve} from "node:path"
import {readRouteIgnored} from "../ignored"
import {hasOwnedFile, isPublicSegment, readContainedDirectory, readPackageManifest} from "./files"
import type {PackageManifest, RoutePosition} from "./types"

/** Переходит по workspace prefix либо входит в объявленный вложенный пакет. */
export async function enterWorkspace(
  rootPath: string,
  position: RoutePosition,
  manifest: PackageManifest,
  segment: string,
): Promise<RoutePosition | null> {
  if (!isPublicSegment(segment)) return null
  const relativeSegments = [...position.relativeSegments, segment]
  const workspacePath = relativeSegments.join("/")

  if (!manifest.workspaces.includes(workspacePath)) {
    if (!manifest.workspaces.some(workspace => workspace.startsWith(`${workspacePath}/`))) return null
    const directory = await readContainedDirectory(rootPath, resolve(position.packagePath, ...relativeSegments))
    return directory === null ? null : {
      ...position,
      relativeSegments,
      directory,
      scenarioOwner: false,
      moduleOwner: false,
      stopsTraversal: false,
    }
  }

  const packagePath = await readContainedDirectory(rootPath, resolve(position.packagePath, ...relativeSegments))
  if (packagePath === null) return null
  const childManifest = await readPackageManifest(packagePath)
  if (childManifest === null) return null
  return {
    packageId: childManifest.name,
    packagePath,
    relativeSegments: [],
    directory: packagePath,
    scenarioOwner: true,
    moduleOwner: true,
    stopsTraversal: false,
  }
}

/** Перечисляет существующие file-backed views непосредственного владельца. */
export async function readAvailableViews(
  rootPath: string,
  ownerPath: string,
  scenarioOwner: boolean,
  moduleOwner: boolean,
  repository: string | null,
): Promise<readonly ("scenarios" | "contract" | "dependencies")[]> {
  const views: ("scenarios" | "contract" | "dependencies")[] = []
  const specDirectory = resolve(ownerPath, "spec")
  const scenarioTs = resolve(specDirectory, "scenario.spec.ts")
  const scenarioTsx = resolve(specDirectory, "scenario.spec.tsx")
  const dependencies = resolve(specDirectory, "deps.spec.ts")
  const contractDirectory = resolve(ownerPath, "contract")
  const contractInput = resolve(contractDirectory, "input.ts")
  const contractOutput = resolve(contractDirectory, "output.ts")
  const ignored = new Set((await readRouteIgnored({
    root: rootPath,
    paths: [
      specDirectory,
      scenarioTs,
      scenarioTsx,
      dependencies,
      contractDirectory,
      contractInput,
      contractOutput,
    ],
    repository,
  })).ignored)
  if (scenarioOwner && !ignored.has(specDirectory) && (
    (!ignored.has(scenarioTs) && await hasOwnedFile(rootPath, ownerPath, "spec/scenario.spec.ts"))
    || (!ignored.has(scenarioTsx) && await hasOwnedFile(rootPath, ownerPath, "spec/scenario.spec.tsx"))
  )) views.push("scenarios")
  if (moduleOwner && !ignored.has(contractDirectory) && (
    (!ignored.has(contractInput) && await hasOwnedFile(rootPath, ownerPath, "contract/input.ts"))
    || (!ignored.has(contractOutput) && await hasOwnedFile(rootPath, ownerPath, "contract/output.ts"))
  )) views.push("contract")
  if (moduleOwner
    && !ignored.has(specDirectory)
    && !ignored.has(dependencies)
    && await hasOwnedFile(rootPath, ownerPath, "spec/deps.spec.ts")) views.push("dependencies")
  return views
}

/** Перечисляет имена непосредственных workspace branches в authored порядке. */
export function readWorkspaceChildNames(position: RoutePosition, manifest: PackageManifest): readonly string[] {
  const names = new Set<string>()
  const workspacePrefix = position.relativeSegments.length === 0
    ? ""
    : `${position.relativeSegments.join("/")}/`
  for (const workspace of manifest.workspaces) {
    if (!workspace.startsWith(workspacePrefix)) continue
    const remainder = workspace.slice(workspacePrefix.length)
    const child = remainder.split("/")[0]
    if (child && isPublicSegment(child)) names.add(child)
  }

  return [...names]
}
