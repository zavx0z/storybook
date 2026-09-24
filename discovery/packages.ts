/** Обнаруживает пакеты и их публичную файловую структуру без деклараций Storybook. */
import {createHash} from "node:crypto"
import {lstat, readFile, realpath} from "node:fs/promises"
import {basename, dirname, join, resolve} from "node:path"
import type {StorybookCatalog, StorybookCatalogScope, StorybookPackage} from "../catalog/catalog.t"
import {EXTERNAL_STORYBOOK_SCHEMA_VERSION} from "../catalog/protocol"
import {readWorkspacePackages} from "@storybook/route/workspaces"
import {discoverStorybookDirectories} from "./directories"
import {validateExternalStorybookPackageId} from "./identity"

/** Границы повторного анализа исходников владельца. */
export interface DiscoverStorybookPackagesOptions {
  readonly dirtyScopeRoots?: readonly string[]
  readonly onAnalysisSession?: (kind: "contract" | "dependency") => void
}

/**
Читает непосредственный package.json и workspaces каждого подключённого корня.
Не загружает исполняемый код и не читает проектные файлы конфигурации Storybook.
При обновлении изолирует ошибку владельца, сохраняя его предыдущий рабочий состав.
*/
export async function discoverStorybookPackages(
  inputs: readonly string[],
  previous?: StorybookCatalog,
  options: DiscoverStorybookPackagesOptions = {},
): Promise<StorybookCatalog> {
  if (inputs.length === 0) throw new Error("Storybook requires at least one package directory")
  const scopes = new Map<string, StorybookCatalogScope>()
  const names = new Map<string, string>()
  const dirty = options.dirtyScopeRoots === undefined ? null : new Set(options.dirtyScopeRoots.map(path => resolve(path)))
  const visit = async (input: string): Promise<StorybookCatalogScope> => {
    const requested = resolve(input)
    const selectedRoot = basename(requested) === "package.json" ? dirname(requested) : requested
    const root = await realpath(selectedRoot).catch(async () => join(await realpath(dirname(selectedRoot)).catch(() => dirname(selectedRoot)), basename(selectedRoot)))
    const existing = scopes.get(root)
    if (existing) return existing
    const retained = previous?.scopes.find(scope => scope.scopeRoot === root)
    let tentativeName: string | undefined
    try {
      const info = await lstat(selectedRoot)
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`Package root must be an exact directory: ${root}`)
      }
      const path = join(root, "package.json")
      const metadata = await lstat(path)
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Package metadata must be an exact file: ${path}`)
      const source = await readFile(path, "utf8")
      const value: unknown = JSON.parse(source)
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid package.json: ${path}`)
      const data = value as Record<string, unknown>
      const name = validateExternalStorybookPackageId(data.name, `package.json name: ${path}`)
      tentativeName = name
      if (names.has(name) && names.get(name) !== root) throw new Error(`Duplicate package identity: ${name}`)
      names.set(name, root)
      const label = data.label === undefined ? name : data.label
      if (typeof label !== "string" || label.trim().length === 0) throw new Error(`Invalid package label: ${path}`)
      const workspace = data.workspaces === undefined ? {roots: [], watchPaths: [root]} : await readWorkspacePackages({root, value: data.workspaces})
      const readmePath = join(root, "README.md")
      const readme = await lstat(readmePath).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      let entry: StorybookPackage = Object.freeze({
        schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
        kind: "package", id: name, canonicalId: `package:${name}`, label,
        ...(typeof data.description === "string" ? {description: data.description} : {}),
        source: Object.freeze({path, pointer: ""}), scopeRoot: root,
        readmePath: readme?.isFile() && !readme.isSymbolicLink() ? readmePath : null,
        digest: createHash("sha256").update(source).digest("hex"),
        packageJsonPath: path, packageName: name,
        structurePaths: Object.freeze([path, readmePath, ...workspace.watchPaths]),
      })
      scopes.set(root, entry)
      const children: string[] = []
      for (const child of workspace.roots) children.push((await visit(child)).canonicalId)
      entry = Object.freeze({...entry, packageIds: Object.freeze(children)})
      scopes.set(root, entry)
      return entry
    } catch (error) {
      if (tentativeName !== undefined && names.get(tentativeName) === root) names.delete(tentativeName)
      if (error instanceof Error && /Duplicate package identity/u.test(error.message)) throw error
      if (previous === undefined) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (retained !== undefined) {
        const keep = (owner: StorybookCatalogScope): void => {
          if (owner.kind === "package") {
            const previousRoot = names.get(owner.id)
            if (previousRoot !== undefined && previousRoot !== owner.scopeRoot) throw new Error(`Duplicate package identity: ${owner.id}`)
            names.set(owner.id, owner.scopeRoot)
          }
          scopes.set(owner.scopeRoot, owner)
          if (owner.kind === "package") for (const id of owner.packageIds ?? []) {
            const child = previous.scopes.find(scope => scope.canonicalId === id)
            if (child) keep(child)
          }
        }
        keep(retained)
        const failed = Object.freeze({...retained, resolutionError: message})
        scopes.set(root, failed)
        return failed
      }
      const id = `unavailable-${createHash("sha256").update(root).digest("hex").slice(0, 24)}`
      const failed: StorybookCatalogScope = Object.freeze({
        schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
        kind: "unavailable", id, canonicalId: `unavailable:${id}`, label: `${basename(root)} (недоступен)`,
        source: {path: join(root, "package.json"), pointer: ""}, scopeRoot: root, readmePath: null,
        digest: createHash("sha256").update(root).digest("hex"), resolutionError: message,
        structurePaths: [root, join(root, "package.json")],
      })
      scopes.set(root, failed)
      return failed
    }
  }
  const rootIds: string[] = []
  for (const input of inputs) {
    const entry = await visit(input)
    if (!rootIds.includes(entry.canonicalId)) rootIds.push(entry.canonicalId)
  }
  const rootSet = new Set(rootIds)
  const children = new Map<string, string[]>()
  for (const scope of scopes.values()) {
    if (rootSet.has(scope.canonicalId)) continue
    let parent = dirname(scope.scopeRoot)
    while (dirname(parent) !== parent) {
      const owner = scopes.get(parent)
      if (owner?.kind === "package") {
        const values = children.get(parent) ?? []
        values.push(scope.canonicalId)
        children.set(parent, values)
        break
      }
      parent = dirname(parent)
    }
  }
  for (const [root, scope] of scopes) {
    if (scope.kind === "package") scopes.set(root, Object.freeze({...scope, packageIds: Object.freeze(children.get(root) ?? [])}))
  }
  const packageRoots = new Set(scopes.keys())
  for (const [root, scope] of scopes) {
    if (scope.kind !== "package" || scope.resolutionError !== undefined) continue
    const retained = previous?.scopes.find(owner => owner.scopeRoot === root)
    if (dirty !== null && !dirty.has(root) && retained?.kind === "package" && retained.digest === scope.digest &&
      retained.resolutionError === undefined && JSON.stringify(retained.packageIds ?? []) === JSON.stringify(scope.packageIds ?? [])) {
      scopes.set(root, Object.freeze({...retained, packageIds: scope.packageIds ?? []}))
      continue
    }
    try {
      const found = await discoverStorybookDirectories(root, packageRoots, options.onAnalysisSession)
      scopes.set(root, Object.freeze({...scope, ...found.rootMetadata, directories: found.directories,
        structurePaths: Object.freeze([...new Set([...(scope.structurePaths ?? []), ...found.watchPaths])]),
      }))
    } catch (error) {
      if (previous === undefined) throw error
      scopes.set(root, Object.freeze({...(retained ?? scope), resolutionError: error instanceof Error ? error.message : String(error)}))
    }
  }
  return Object.freeze({schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION, rootIds: Object.freeze(rootIds), scopes: Object.freeze([...scopes.values()])})
}
