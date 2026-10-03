import {createHash} from "node:crypto"
import {existsSync, readFileSync} from "node:fs"
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import {readStorybookPackageRoot} from "./owner-identity"
import type {StorybookPackageOwner} from "../contract/owner"
import type {StorybookResolutionEvidence} from "../contract/models"
import {canonicalLexicalFile} from "./compiler"

type ObjectValue = Record<string, unknown>
type DirectoryMetadata = Readonly<{
  manifest: boolean
  lock: boolean
  binaryLock: boolean
  git: boolean
}>
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value)
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"] as const

/**
Проецирует resolver metadata для фактически компилируемых файлов. Runtime external
targets передаются отдельно в identity вызывающей сборки: их реализация и integrity
не меняют байты импортера. Compiler и semantic dependencies входят в files и потому
проверяются наравне с собственным исходником.

Каждый вызов заново читает manifests и Bun lock records. Добавление постороннего
workspace не меняет evidence; версия, integrity, dependency declaration или override
выбранного владельца меняют его. Полный manifest/lock не хешируется скрыто.
*/
export function readStorybookResolutionEvidence(input: Readonly<{
  files: readonly string[]
  /** Доверенный результат уже выполненного resolver: точные canonical named owner roots всех files. */
  ownerRoots?: readonly string[]
}>): StorybookResolutionEvidence {
  // Кеши существуют только внутри вызова: следующий evidence читает metadata заново.
  const metadataByDirectory = new Map<string, DirectoryMetadata>()
  const manifestByPath = new Map<string, ObjectValue>()
  const nearestOwnerByDirectory = new Map<string, StorybookPackageOwner | null>()
  const validatedOwnerByDirectory = new Map<string, string>()
  const visitedAncestors = new Set<string>()
  const metadataAt = (directory: string): DirectoryMetadata => {
    let metadata = metadataByDirectory.get(directory)
    if (metadata === undefined) {
      metadata = Object.freeze({
        manifest: existsSync(join(directory, "package.json")),
        lock: existsSync(join(directory, "bun.lock")),
        binaryLock: existsSync(join(directory, "bun.lockb")),
        git: existsSync(join(directory, ".git")),
      })
      metadataByDirectory.set(directory, metadata)
    }
    return metadata
  }
  const manifestAt = (path: string): ObjectValue => {
    let manifest = manifestByPath.get(path)
    if (manifest === undefined) {
      manifest = readObject(path)
      manifestByPath.set(path, manifest)
    }
    return manifest
  }
  const owners = new Map<string, ObjectValue>()
  const selectedFiles = [...input.files].sort()
  if (input.ownerRoots !== undefined) {
    for (const root of input.ownerRoots) {
      const owner = readStorybookPackageRoot(root)
      if (root !== owner.root) throw new Error(`Resolver ownerRoots must be canonical: ${root}`)
      if (!hasSelectedFile(root, selectedFiles)) throw new Error(`Resolver owner root has no selected file: ${root}`)
      owners.set(root, manifestAt(join(root, "package.json")))
    }
  }
  const roots = new Set<string>()
  for (const file of input.files) {
    if (input.ownerRoots === undefined) {
      const owner = nearestPackageOwner(file, nearestOwnerByDirectory, metadataAt)
      if (owner !== null && !owners.has(owner.root)) owners.set(owner.root, manifestAt(join(owner.root, "package.json")))
    } else validateKnownOwner(file, owners, validatedOwnerByDirectory, metadataAt, manifestAt)
    let directory = dirname(file)
    while (true) {
      if (visitedAncestors.has(directory)) break
      visitedAncestors.add(directory)
      const metadata = metadataAt(directory)
      if (metadata.manifest || metadata.lock || metadata.binaryLock) roots.add(directory)
      if (metadata.git || dirname(directory) === directory) break
      directory = dirname(directory)
    }
  }
  const names = new Set([...owners.values()].flatMap(owner => typeof owner.name === "string" ? [owner.name] : []))
  const declarations = [...roots].sort().map(root => {
    const path = join(root, "package.json")
    const manifest = metadataAt(root).manifest ? manifestAt(path) : {}
    return {
      root,
      ...(owners.has(root) ? {owner: selectedManifest(manifest, names)} : {}),
      ...(!("name" in manifest) && Object.keys(manifest).length > 0 ? {scope: manifest} : {}),
      dependencies: Object.fromEntries(dependencyFields.map(field => [field, selectDeclarations(manifest[field], names)])),
    }
  })
  const locks = [...roots].sort().flatMap((root): unknown[] => {
    const path = join(root, "bun.lock")
    if (!metadataAt(root).lock) {
      const binary = join(root, "bun.lockb")
      return metadataAt(root).binaryLock ? [{root, binaryDigest: createHash("sha256").update(readFileSync(binary)).digest("hex")}] : []
    }
    const lock = manifestAt(path)
    const workspacePaths = new Set([...owners.keys()].map(owner => relative(root, owner).split("\\").join("/")))
    const workspaces = object(lock.workspaces) ? Object.fromEntries(Object.entries(lock.workspaces)
      .filter(([path]) => path === "" || workspacePaths.has(path))
      .map(([path, value]) => [path, object(value) ? path === "" && !owners.has(root)
        ? Object.fromEntries(dependencyFields.map(field => [field, selectDeclarations(value[field], names)]))
        : selectedManifest(value, names) : value])) : {}
    const packages = object(lock.packages) ? Object.fromEntries(Object.entries(lock.packages)
      .filter(([key, record]) => selectedRecord(key, record, names, owners))
      .map(([key, record]) => [key, Array.isArray(record) ? record.map(value => object(value)
        ? {...value, ...Object.fromEntries(dependencyFields.filter(field => field in value).map(field => [field, selectDeclarations(value[field], names)]))}
        : value) : record])) : {}
    return [{root, lockfileVersion: lock.lockfileVersion, configVersion: lock.configVersion, workspaces, packages}]
  })
  const resolution = [...owners].sort(([left], [right]) => left.localeCompare(right))
    .map(([root, manifest]) => ({root, fields: resolverFields(manifest)}))
  return {declarations, locks, resolution}
}

function hasSelectedFile(root: string, sortedFiles: readonly string[]): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  let left = 0
  let right = sortedFiles.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (sortedFiles[middle]! < prefix) left = middle + 1
    else right = middle
  }
  return sortedFiles[left]?.startsWith(prefix) ?? false
}

/**
Известный named owner не разрешает пропустить более близкого named владельца.
Nameless npm scope manifests остаются в evidence целиком; caller может дополнительно
сохранять их exact bytes как control inputs своего собственного lifecycle.
*/
function validateKnownOwner(
  file: string,
  owners: ReadonlyMap<string, ObjectValue>,
  cache: Map<string, string>,
  metadataAt: (directory: string) => DirectoryMetadata,
  manifestAt: (path: string) => ObjectValue,
): void {
  if (!isAbsolute(file) || file !== canonicalLexicalFile(file)) throw new Error(`Resolver files must be canonical exact files: ${file}`)
  let directory = dirname(resolve(file))
  const visited: string[] = []
  let root: string | undefined
  let skippedManifest: string | undefined
  while (true) {
    root = cache.get(directory)
    if (root !== undefined) break
    if (owners.has(directory)) {
      root = directory
      cache.set(directory, root)
      break
    }
    const manifestPath = join(directory, "package.json")
    if (skippedManifest === undefined && metadataAt(directory).manifest && "name" in manifestAt(manifestPath)) {
      skippedManifest = manifestPath
    }
    visited.push(directory)
    const parent = dirname(directory)
    if (parent === directory) break
    directory = dirname(directory)
  }
  if (root === undefined) throw new Error(`Resolver file belongs to no supplied owner: ${file}`)
  if (skippedManifest !== undefined) throw new Error(`Supplied resolver owner skips a named package: ${skippedManifest}`)
  for (const path of visited) cache.set(path, root)
}

function nearestPackageOwner(
  file: string,
  cache: Map<string, StorybookPackageOwner | null>,
  metadataAt: (directory: string) => DirectoryMetadata,
): StorybookPackageOwner | null {
  let directory = dirname(resolve(file))
  const visited: string[] = []
  let owner: StorybookPackageOwner | null = null
  while (true) {
    if (cache.has(directory)) {
      owner = cache.get(directory)!
      break
    }
    if (metadataAt(directory).manifest) {
      owner = readStorybookPackageRoot(directory)
      cache.set(directory, owner)
      break
    }
    visited.push(directory)
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  for (const path of visited) cache.set(path, owner)
  return owner
}

/** Bundler metadata владельца не включает описания, scripts и зависимости посторонних пакетов. */
function selectedManifest(value: ObjectValue, names: ReadonlySet<string>): ObjectValue {
  return {
    ...resolverFields(value), version: value.version, sideEffects: value.sideEffects,
    ...Object.fromEntries(dependencyFields.map(field => [field, selectDeclarations(value[field], names)])),
  }
}

/** Одна проекция resolver contract: используется fingerprint и защитой от тёплого native cache. */
function resolverFields(value: ObjectValue): ObjectValue {
  return {
    name: value.name,
    type: value.type,
    main: value.main,
    module: value.module,
    exports: value.exports,
    imports: value.imports,
    browser: value.browser,
  }
}

/** npm override selectors могут быть version-qualified или вложенными. */
function selectDeclarations(value: unknown, names: ReadonlySet<string>): ObjectValue {
  if (!object(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([selector, declaration]) => {
    const selected = [...names].some(name => selector === name || selector.startsWith(`${name}@`) || selector.endsWith(`/${name}`))
    if (selected) return [[selector, declaration]]
    const nested = selectDeclarations(declaration, names)
    return Object.keys(nested).length > 0 ? [[selector, nested]] : []
  }))
}

/** Учитывает точные top-level lock ids и nested npm instances той же выбранной версии. */
function selectedRecord(key: string, record: unknown, names: ReadonlySet<string>, owners: ReadonlyMap<string, ObjectValue>): boolean {
  if (names.has(key)) return true
  if (!Array.isArray(record) || typeof record[0] !== "string") return false
  return [...owners.values()].some(owner => typeof owner.name === "string" && typeof owner.version === "string" && record[0] === `${owner.name}@${owner.version}`)
}

function readObject(path: string): ObjectValue {
  const value = Bun.JSONC.parse(readFileSync(path, "utf8")) as unknown
  if (!object(value)) throw new Error(`Invalid resolver metadata: ${path}`)
  return value
}
