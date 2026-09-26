import {readRouteDirectories} from "@storybook/route/directories"
import {readRouteIgnored} from "@storybook/route/ignored"
import {constants} from "node:fs"
import {lstat, open, realpath} from "node:fs/promises"
import {readModuleDocumentation} from "@archetypes/package/documentation"
import {readDependencySpecs} from "./dependency-spec.ts"
import {readContractDocumentations} from "./contract-documentation.ts"
import {basename, join, relative} from "node:path"
import type {StorybookDirectory} from "../catalog/catalog.t.ts"

type ViewMetadata = Pick<StorybookDirectory, "moduleDocumentation" | "scenarioSpec" | "contractDocumentation" | "dependencySpec">
const MAX_MODULE_SOURCE_BYTES = 1_048_576

/** Обходит категории до публичного index.tsx, собственного src или отдельного пакета. */
export async function discoverStorybookDirectories(
  root: string,
  packageRoots: ReadonlySet<string>,
  onAnalysisSession: (kind: "contract" | "dependency") => void = () => {},
): Promise<Readonly<{directories: readonly StorybookDirectory[]; rootMetadata: ViewMetadata; watchPaths: readonly string[]}>> {
  root = await realpath(root)
  const visibility = await readRouteIgnored({root, paths: []})
  const watchPaths = new Set<string>(visibility.watchPaths)
  const contractPathsByDirectory = new Map<string, readonly string[]>()
  const scenarioPathsByDirectory = new Map<string, readonly string[]>()
  const dependencyPathByDirectory = new Map<string, string>()
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
  for (const path of rootEntries) watchPaths.add(path)
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
  const collectViews = async (path: string, hasEntry: boolean): Promise<void> => {
    if (!hasEntry) return
    for (const [name, files] of [
      ["contract", ["input.ts", "output.ts"]],
      ["spec", ["deps.spec.ts", "scenario.spec.ts", "scenario.spec.tsx"]],
    ] as const) {
      const directory = join(path, name)
      const paths = files.map(file => join(directory, file))
      for (const watched of [directory, ...paths]) watchPaths.add(watched)
      const excluded = await ignored([directory, ...paths])
      const info = await lstat(directory).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      if (!info?.isDirectory() || info.isSymbolicLink() || excluded.has(directory)) continue
      const found: string[] = []
      for (const source of paths) {
        if (excluded.has(source)) continue
        const file = await lstat(source).catch(error => {
          if (error.code !== "ENOENT") throw error
          return null
        })
        if (file?.isFile() && !file.isSymbolicLink()) found.push(source)
      }
      if (name === "contract" && found.length) contractPathsByDirectory.set(path, Object.freeze(found))
      if (name === "spec") {
        const dependency = found.find(source => basename(source) === "deps.spec.ts")
        if (dependency !== undefined) dependencyPathByDirectory.set(path, dependency)
        const scenarios = found.filter(source => source !== dependency)
        if (scenarios.length) scenarioPathsByDirectory.set(path, Object.freeze(scenarios))
      }
    }
  }
  const visit = async (parent: string): Promise<readonly StorybookDirectory[]> => {
    watchPaths.add(parent)
    watchPaths.add(join(parent, ".gitignore"))
    const result: StorybookDirectory[] = []
    const listing = await readRouteDirectories({root, parent, packagePaths: [...packageRoots], repository: visibility.repository})
    for (const path of listing.watchPaths) watchPaths.add(path)
    const entries = listing.directories
    for (const entry of entries) {
      const path = entry.path
      watchPaths.add(path)
      watchPaths.add(join(path, ".gitignore"))
      const entryPaths = [join(path, "index.tsx"), join(path, "index.ts")]
      for (const entryPath of entryPaths) watchPaths.add(entryPath)
      const publicEntry = entry.entry === null ? undefined : join(path, entry.entry === "tsx" ? "index.tsx" : "index.ts")
      const moduleDocumentation = publicEntry === undefined ? undefined : await readDocumentation(publicEntry)
      watchPaths.add(join(path, "src"))
      const isModule = entry.module
      await collectViews(path, isModule || publicEntry !== undefined)
      const children = isModule ? [] : await visit(path)
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
  const discovered = await visit(root)
  const contractPaths = [...contractPathsByDirectory.values()].flat()
  const dependencyPaths = [...dependencyPathByDirectory.values()]
  if (contractPaths.length > 0) onAnalysisSession("contract")
  const contracts = contractPaths.length === 0 ? new Map() : await readContractDocumentations(root, contractPaths)
  if (dependencyPaths.length > 0) onAnalysisSession("dependency")
  const dependencies = dependencyPaths.length === 0 ? new Map() : await readDependencySpecs(root, dependencyPaths)
  const viewMetadata = (path: string): ViewMetadata => {
    const ownedContracts = contractPathsByDirectory.get(path) ?? []
    const sources = ownedContracts.flatMap(path => contracts.get(path)?.sources ?? [])
    for (const source of sources) watchPaths.add(source.sourcePath)
    const documents = ownedContracts.flatMap((path): import("../catalog/catalog.t.ts").StorybookContractDocument[] => {
      const contract = contracts.get(path)
      return contract === undefined ? [] : [{
        direction: basename(path) === "input.ts" ? "input" : "output",
        document: contract.document,
      }]
    })
    const scenarioPaths = scenarioPathsByDirectory.get(path)
    const dependencyPath = dependencyPathByDirectory.get(path)
    const dependencySpec = dependencyPath === undefined ? undefined : dependencies.get(dependencyPath)
    return Object.freeze({
      ...(dependencySpec === undefined ? {} : {dependencySpec}),
      ...(scenarioPaths === undefined ? {} : {scenarioSpec: {sourcePaths: scenarioPaths}}),
      ...(documents.length === 0 ? {} : {contractDocumentation: {sources, documents}}),
    })
  }
  const rootMetadata = Object.freeze({
    ...viewMetadata(root),
    ...(rootDocumentation ? {moduleDocumentation: rootDocumentation} : {}),
  })
  const directories = discovered.map(directory => Object.freeze({...directory, ...viewMetadata(directory.path)}))
  return Object.freeze({directories: Object.freeze(directories), rootMetadata, watchPaths: Object.freeze([...watchPaths])})
}
