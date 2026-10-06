import RouteDirectoriesOwner from "@zavx0z/storybook-package-route-directories"
import RouteIgnoredOwner from "@zavx0z/storybook-package-route-ignored"
const readRouteDirectories = RouteDirectoriesOwner
const readRouteIgnored = RouteIgnoredOwner
import {constants} from "node:fs"
import {lstat, open, readFile, realpath} from "node:fs/promises"
import {createHash} from "node:crypto"
import readModuleDocumentation from "@zavx0z/storybook-package-documentation"
import readPackageJson from "@zavx0z/storybook-package-package-json"
import readPackageIndex from "@zavx0z/storybook-package-index"
import readContract from "@zavx0z/storybook-contracts"
import {readDependencySpecs} from "./dependency-spec.ts"
import {readContractDocumentationResults, type ContractDocumentationResult} from "./contract-documentation.ts"
import {basename, dirname, join, relative, resolve, sep} from "node:path"
import type {StorybookDirectory, StorybookEntry} from "../contract/catalog"

type ViewMetadata = Pick<StorybookDirectory, "moduleDocumentation" | "scenarioSpec" | "contractDocumentation" | "dependencySpec"> & {entries?: readonly StorybookEntry[]}
const MAX_MODULE_SOURCE_BYTES = 1_048_576

/** Физические входы одного владельца до общего анализа контрактов. */
export interface PreparedStorybookDirectories {
  readonly root: string
  readonly discovered: readonly StorybookDirectory[]
  readonly rootDocumentation: StorybookDirectory["moduleDocumentation"]
  readonly inputs: Set<string>
  readonly contractPathsByDirectory: ReadonlyMap<string, readonly string[]>
  readonly scenarioPathsByDirectory: ReadonlyMap<string, readonly string[]>
  readonly dependencyPathByDirectory: ReadonlyMap<string, string>
  readonly contractPaths: readonly string[]
  readonly dependencyPaths: readonly string[]
  readonly entries: readonly (Omit<StorybookEntry, "contractDocumentation"> & {contractPaths: readonly string[]})[]
  readonly protocolSources: readonly {path: string, digest: string}[]
}

/** Обходит категории до публичного index.tsx, собственного src или отдельного пакета. */
export async function prepareStorybookDirectories(
  root: string,
  packageRoots: ReadonlySet<string>,
): Promise<PreparedStorybookDirectories> {
  root = await realpath(root)
  const visibility = await readRouteIgnored({root, paths: []})
  const inputs = new Set<string>(visibility.inputs)
  const contractPathsByDirectory = new Map<string, readonly string[]>()
  const scenarioPathsByDirectory = new Map<string, readonly string[]>()
  const dependencyPathByDirectory = new Map<string, string>()
  const publicEntries: (Omit<StorybookEntry, "contractDocumentation"> & {contractPaths: readonly string[]})[] = []
  const protocolSources: {path: string, digest: string}[] = []
  const ignored = async (paths: readonly string[]): Promise<ReadonlySet<string>> =>
    new Set((await readRouteIgnored({root, paths, repository: visibility.repository})).ignored)
  const readDocumentation = async (path: string): Promise<StorybookDirectory["moduleDocumentation"]> => {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const metadata = await file.stat()
      if (!metadata.isFile() || metadata.size > MAX_MODULE_SOURCE_BYTES) throw new Error(`Module documentation source exceeds limit or is not a file: ${path}`)
      const buffer = Buffer.allocUnsafe(MAX_MODULE_SOURCE_BYTES + 1)
      let bytes = 0
      while (bytes < buffer.length) {
        const chunk = await file.read(buffer, bytes, buffer.length - bytes, null)
        if (chunk.bytesRead === 0) break
        bytes += chunk.bytesRead
      }
      if (bytes > MAX_MODULE_SOURCE_BYTES) throw new Error(`Module documentation source exceeds limit or is not a file: ${path}`)
      return readModuleDocumentation({source: buffer.toString("utf8", 0, bytes), path}) ?? undefined
    } finally { await file.close() }
  }
  const rootEntries = [join(root, "index.tsx"), join(root, "index.ts")]
  for (const path of rootEntries) inputs.add(path)
  const excludedRootEntries = await ignored(rootEntries)
  let rootDocumentation: StorybookDirectory["moduleDocumentation"]
  for (const path of rootEntries) {
    if (excludedRootEntries.has(path)) continue
    const metadata = await lstat(path).catch(error => {
      if (error.code !== "ENOENT") throw error
      return null
    })
    if (!metadata?.isFile() || metadata.isSymbolicLink()) continue
    rootDocumentation = await readDocumentation(path)
    break
  }
  /** Читает только собственные views; package.json резервирует вложенного владельца и наблюдается даже до его появления. */
  const collectViews = async (path: string, hasEntry: boolean): Promise<void> => {
    if (!hasEntry) return
    for (const [name, files] of [
      ["contract", ["index.ts", "input.ts", "output.ts"]],
      ["spec", ["deps.spec.ts", "scenario.spec.ts", "scenario.spec.tsx"]],
    ] as const) {
      const directory = join(path, name)
      const paths = files.map(file => join(directory, file))
      const packageJson = join(directory, "package.json")
      for (const watched of [directory, packageJson, ...paths]) inputs.add(watched)
      const excluded = await ignored([directory, ...paths])
      const info = await lstat(directory).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      if (!info?.isDirectory() || info.isSymbolicLink() || excluded.has(directory)) continue
      if (packageRoots.has(directory)) continue
      const boundary = await lstat(packageJson).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      if (boundary !== null) continue
      const found: string[] = []
      for (const source of paths) {
        if (excluded.has(source)) continue
        const file = await lstat(source).catch(error => {
          if (error.code !== "ENOENT") throw error
          return null
        })
        if (file?.isFile() && !file.isSymbolicLink()) found.push(source)
      }
      if (name === "contract" && found.length) {
        const namespace = found.find(source => basename(source) === "index.ts")
        if (namespace !== undefined && found.length > 1) {
          throw new Error(`Роли контракта одновременно объявлены в index.ts и отдельных файлах: ${directory}`)
        }
        contractPathsByDirectory.set(path, Object.freeze(found))
      }
      if (name === "spec") {
        const dependency = found.find(source => basename(source) === "deps.spec.ts")
        if (dependency !== undefined) dependencyPathByDirectory.set(path, dependency)
        const scenarios = found.filter(source => source !== dependency)
        if (scenarios.length) scenarioPathsByDirectory.set(path, Object.freeze(scenarios))
      }
    }
  }
  const visit = async (parent: string): Promise<readonly StorybookDirectory[]> => {
    inputs.add(parent)
    inputs.add(join(parent, ".gitignore"))
    const result: StorybookDirectory[] = []
    const listing = await readRouteDirectories({root, parent, packagePaths: [...packageRoots], repository: visibility.repository})
    for (const path of listing.inputs) inputs.add(path)
    const entries = listing.directories
    for (const entry of entries) {
      const path = entry.path
      inputs.add(path)
      inputs.add(join(path, ".gitignore"))
      const entryPaths = [join(path, "index.tsx"), join(path, "index.ts")]
      for (const entryPath of entryPaths) inputs.add(entryPath)
      const publicEntry = entry.entry === null ? undefined : join(path, entry.entry === "tsx" ? "index.tsx" : "index.ts")
      const moduleDocumentation = publicEntry === undefined ? undefined : await readDocumentation(publicEntry)
      inputs.add(join(path, "src"))
      const isModule = entry.module
      await collectViews(path, isModule || publicEntry !== undefined)
      const containsPackages = [...packageRoots].some(packageRoot => packageRoot.startsWith(`${path}${sep}`))
      const children = isModule && !containsPackages ? [] : await visit(path)
      result.push(Object.freeze({
        path,
        relativePath: relative(root, path),
        name: entry.name,
        ...(parent === root ? {} : {parentRelativePath: relative(root, parent)}),
        ...(moduleDocumentation ? {moduleDocumentation} : {}),
      }))
      result.push(...children)
    }
    return Object.freeze(result)
  }
  await collectViews(root, true)
  const manifestPath = join(root, "package.json")
  inputs.add(manifestPath)
  const manifestFile = await lstat(manifestPath).catch(error => {
    if (error.code !== "ENOENT") throw error
    return null
  })
  const metadata = manifestFile?.isFile() && !manifestFile.isSymbolicLink()
    ? await readPackageJson({path: manifestPath}) : null
  const index = metadata ? await readPackageIndex({path: root, exports: metadata.exports}) : {entries: []}
  const entryTargets = index.entries.filter(entry => entry.path === "." && entry.code && entry.status === "owned"
    && entry.target && dirname(resolve(root, entry.target)) === root)
  if (entryTargets.some(entry => !/^index\.tsx?$/u.test(basename(entry.target!)))) {
    const protocols = await readContract({path: root})
    const errors = protocols.diagnostics.filter(diagnostic => diagnostic.severity === "error")
    if (errors.length) throw new Error(errors.map(diagnostic => diagnostic.message).join("\n"))
    protocolSources.push(...protocols.sources)
    for (const source of protocols.sources) inputs.add(source.path)
    for (const target of [...new Set(entryTargets.map(entry => entry.target!))]) {
      const path = resolve(root, target)
      if ((await ignored([path])).has(path)) throw new Error(`Публичный вход игнорируется: ${path}`)
      const namespaces = protocols.entries.filter(entry => entry.path === path && entry.exportPath === ".")
        .flatMap(entry => entry.namespaces)
      const contractPaths = [...new Set(namespaces.map(namespace => namespace.declaration.path))]
      if (!contractPaths.length) throw new Error(`Средовой вход не раскрывает протокол: ${path}`)
      const moduleDocumentation = await readDocumentation(path)
      inputs.add(path)
      publicEntries.push({path, relativePath: relative(root, path),
        conditions: entryTargets.filter(entry => entry.target === target).map(entry => entry.conditions),
        contractPaths, ...(moduleDocumentation ? {moduleDocumentation} : {})})
    }
  }
  const discovered = await visit(root)
  const contractPaths = [...new Set([...contractPathsByDirectory.values()].flat().concat(publicEntries.flatMap(entry => entry.contractPaths)))]
  const dependencyPaths = [...dependencyPathByDirectory.values()]
  return {
    root,
    discovered,
    rootDocumentation,
    inputs,
    contractPathsByDirectory,
    scenarioPathsByDirectory,
    dependencyPathByDirectory,
    contractPaths,
    dependencyPaths,
    entries: publicEntries,
    protocolSources,
  }
}

/** Соединяет проверенные contract results с физическим обходом одного владельца. */
export async function completeStorybookDirectories(
  prepared: PreparedStorybookDirectories,
  contractResults: ReadonlyMap<string, ContractDocumentationResult>,
  onAnalysisSession: (kind: "contract" | "dependency") => void = () => {},
): Promise<Readonly<{directories: readonly StorybookDirectory[]; rootMetadata: ViewMetadata; inputs: readonly string[]}>> {
  const {root, discovered, rootDocumentation, inputs, contractPathsByDirectory, scenarioPathsByDirectory, dependencyPathByDirectory, contractPaths, dependencyPaths} = prepared
  for (const source of prepared.protocolSources) {
    const bytes = await readFile(source.path)
    if (createHash("sha256").update(bytes).digest("hex") !== source.digest) throw new Error(`Протокол изменился во время обнаружения: ${source.path}`)
  }
  const contracts = new Map<string, Extract<ContractDocumentationResult, {ok: true}>["value"]>()
  for (const path of contractPaths) {
    const result = contractResults.get(path)
    if (!result) throw new Error(`Отсутствует результат анализа контракта: ${path}`)
    if (!result.ok) throw result.error
    contracts.set(path, result.value)
  }
  if (dependencyPaths.length > 0) onAnalysisSession("dependency")
  const dependencies: Awaited<ReturnType<typeof readDependencySpecs>> = dependencyPaths.length === 0 ? new Map() : await readDependencySpecs(root, dependencyPaths)
  const contractMetadata = (ownedContracts: readonly string[]) => {
    const sources = ownedContracts.flatMap(path => contracts.get(path)?.sources ?? [])
    for (const source of sources) inputs.add(source.sourcePath)
    const documents = ownedContracts.flatMap((path): import("../contract/catalog").StorybookContractDocument[] => {
      const contract = contracts.get(path)
      if (contract === undefined) return []
      if (!contract.document.declarations.some(declaration => declaration.name.includes("."))) return [{
        direction: basename(path) === "input.ts" ? "input" : "output",
        sourcePath: path,
        document: contract.document,
      }]
      return contract.document.declarations.map(declaration => {
        const role = declaration.name.split(".").at(-1)!
        const direction = role === "Input" ? "input" : role === "Output" ? "output" : "slots"
        return {direction, sourcePath: path, document: {...contract.document, declarations: [declaration]}}
      })
    })
    return documents.length === 0 ? undefined : {sources, documents}
  }
  const viewMetadata = (path: string): ViewMetadata => {
    const contractDocumentation = contractMetadata(contractPathsByDirectory.get(path) ?? [])
    const scenarioPaths = scenarioPathsByDirectory.get(path)
    const dependencyPath = dependencyPathByDirectory.get(path)
    const dependencySpec = dependencyPath === undefined ? undefined : dependencies.get(dependencyPath)
    return Object.freeze({
      ...(dependencySpec === undefined ? {} : {dependencySpec}),
      ...(scenarioPaths === undefined ? {} : {scenarioSpec: {sourcePaths: scenarioPaths}}),
      ...(contractDocumentation === undefined ? {} : {contractDocumentation}),
    })
  }
  const rootMetadata = Object.freeze({
    ...viewMetadata(root),
    ...(rootDocumentation ? {moduleDocumentation: rootDocumentation} : {}),
    ...(prepared.entries.length ? {entries: prepared.entries.map(({contractPaths, ...entry}) => ({
      ...entry, contractDocumentation: contractMetadata(contractPaths)!,
    }))} : {}),
  })
  const directories = discovered.map(directory => Object.freeze({...directory, ...viewMetadata(directory.path)}))
  return Object.freeze({directories: Object.freeze(directories), rootMetadata, inputs: Object.freeze([...inputs])})
}

/** Прямой вызов для одного владельца использует тот же prepare/batch/complete. */
export async function discoverStorybookDirectories(
  root: string,
  packageRoots: ReadonlySet<string>,
  onAnalysisSession: (kind: "contract" | "dependency") => void = () => {},
): Promise<Readonly<{directories: readonly StorybookDirectory[]; rootMetadata: ViewMetadata; inputs: readonly string[]}>> {
  const prepared = await prepareStorybookDirectories(root, packageRoots)
  const results = prepared.contractPaths.length === 0
    ? new Map<string, ContractDocumentationResult>()
    : await readContractDocumentationResults(prepared.root, prepared.contractPaths, () => onAnalysisSession("contract"))
  return completeStorybookDirectories(prepared, results, onAnalysisSession)
}
