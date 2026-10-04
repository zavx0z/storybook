/**
Собирает сведения выбранных пакетов и их вложенных владельцев.
Одинаково обслуживает корень Repo и любой вложенный Package; состав определяется
существующим читателем workspaces, а содержимое каждого владельца остаётся отдельным.
Общий анализ контрактов сохраняет одну session для выбранной порции данных.

@packageDocumentation
*/
import RouteWorkspacesOwner from "@zavx0z/storybook-package-route-workspaces"
const readWorkspacePackages = RouteWorkspacesOwner
import {createHash} from "node:crypto"
import {lstat, readFile, realpath} from "node:fs/promises"
import {basename, dirname, join, resolve} from "node:path"
import type {StorybookCatalogScope, StorybookPackage} from "./contract/catalog"
import {EXTERNAL_STORYBOOK_SCHEMA_VERSION} from "./src/protocol"
import {prepareStorybookDirectories, completeStorybookDirectories, type PreparedStorybookDirectories} from "./src/directories"
import {readContractDocumentationResults, type ContractDocumentationResult} from "./src/contract-documentation"
import Identity from "@zavx0z/storybook-package-identity"
const {package: validateExternalStorybookPackageId} = Identity
import type {Zavx0zStorybookPackageMetadataCollect} from "./contract"

export type {Zavx0zStorybookPackageMetadataCollect} from "./contract"

/**
Читает package.json выбранного пакета и относящийся к нему состав workspaces его Repo.
Вложенность пакетов выводится из физического расположения без повторных деклараций.
Не загружает исполняемый код и не читает проектные файлы конфигурации Storybook.
При обновлении изолирует ошибку владельца, сохраняя его предыдущий рабочий состав.
Физические входы изменяемых владельцев собираются до анализа; все их контракты
читаются одним TypeDoc batch. Ошибка отдельного контракта затрагивает только
его владельца, а ошибка общей session помечает все зависящие от неё scope.
*/
export default async function discoverStorybookPackages(
  inputs: Zavx0zStorybookPackageMetadataCollect.Input[0],
  previous?: Zavx0zStorybookPackageMetadataCollect.Input[1],
  options: NonNullable<Zavx0zStorybookPackageMetadataCollect.Input[2]> = {},
): Promise<Zavx0zStorybookPackageMetadataCollect.Output> {
  if (inputs.length === 0) throw new Error("Storybook requires at least one package directory")
  const scopes = new Map<string, StorybookCatalogScope>()
  const names = new Map<string, string>()
  const dirty = options.dirtyScopeRoots === undefined ? null : new Set(options.dirtyScopeRoots.map(path => resolve(path)))
  const visit = async (input: string, selected = false): Promise<StorybookCatalogScope> => {
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
      const workspace = data.workspaces === undefined && !selected
        ? {roots: [], inputs: [root]}
        : await readWorkspacePackages({root, value: data.workspaces})
      let entry: StorybookPackage = Object.freeze({
        schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
        kind: "package", id: name, canonicalId: `package:${name}`, label,
        ...(typeof data.description === "string" ? {description: data.description} : {}),
        source: Object.freeze({path, pointer: ""}), scopeRoot: root,
        digest: createHash("sha256").update(source).digest("hex"),
        packageJsonPath: path, packageName: name,
        structurePaths: Object.freeze([path, ...workspace.inputs]),
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
        source: {path: join(root, "package.json"), pointer: ""}, scopeRoot: root,
        digest: createHash("sha256").update(root).digest("hex"), resolutionError: message,
        structurePaths: [root, join(root, "package.json")],
      })
      scopes.set(root, failed)
      return failed
    }
  }
  const rootIds: string[] = []
  for (const input of inputs) {
    const entry = await visit(input, true)
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
  const prepared = new Map<string, PreparedStorybookDirectories>()
  for (const [root, scope] of scopes) {
    if (scope.kind !== "package" || scope.resolutionError !== undefined) continue
    const retained = previous?.scopes.find(owner => owner.scopeRoot === root)
    if (dirty !== null && !dirty.has(root) && retained?.kind === "package" && retained.digest === scope.digest &&
      retained.resolutionError === undefined && JSON.stringify(retained.packageIds ?? []) === JSON.stringify(scope.packageIds ?? [])) {
      scopes.set(root, Object.freeze({...retained, packageIds: scope.packageIds ?? []}))
      continue
    }
    try {
      prepared.set(root, await prepareStorybookDirectories(root, packageRoots))
    } catch (error) {
      if (previous === undefined) throw error
      scopes.set(root, Object.freeze({...(retained ?? scope), resolutionError: error instanceof Error ? error.message : String(error)}))
    }
  }
  const contractPaths = [...new Set([...prepared.values()].flatMap(owner => owner.contractPaths))]
  let contractResults: ReadonlyMap<string, ContractDocumentationResult> = new Map()
  let batchError: unknown
  if (contractPaths.length > 0) {
    try {
      contractResults = await readContractDocumentationResults(
        prepared.values().next().value!.root,
        contractPaths,
        () => options.onAnalysisSession?.("contract"),
      )
    } catch (error) {
      if (previous === undefined) throw error
      batchError = error
    }
  }
  for (const [root, owner] of prepared) {
    const scope = scopes.get(root)!
    const retained = previous?.scopes.find(previousScope => previousScope.scopeRoot === root)
    try {
      if (batchError !== undefined && owner.contractPaths.length > 0) throw batchError
      const found = await completeStorybookDirectories(owner, contractResults, options.onAnalysisSession)
      scopes.set(root, Object.freeze({...scope, ...found.rootMetadata, directories: found.directories,
        structurePaths: Object.freeze([...new Set([...(scope.structurePaths ?? []), ...found.inputs])]),
      }))
    } catch (error) {
      if (previous === undefined) throw error
      scopes.set(root, Object.freeze({...(retained ?? scope), resolutionError: error instanceof Error ? error.message : String(error)}))
    }
  }
  return Object.freeze({schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION, rootIds: Object.freeze(rootIds), scopes: Object.freeze([...scopes.values()])})
}
