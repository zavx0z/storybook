import {constants} from "node:fs"
import {lstat, open, readdir, realpath} from "node:fs/promises"
import {readModuleDocumentation} from "./module-documentation.ts"
import {readDependencySpecs} from "./dependency-spec.ts"
import {readContractDocumentations} from "./contract-documentation.ts"
import {basename, dirname, join, relative} from "node:path"
import type {StorybookDirectory} from "../catalog/catalog.t.ts"

/** Обходит категории до публичного index.tsx, собственного src или отдельного пакета. */
export async function discoverStorybookDirectories(
  root: string,
  packageRoots: ReadonlySet<string>,
  onAnalysisSession: (kind: "contract" | "dependency") => void = () => {},
): Promise<Readonly<{directories: readonly StorybookDirectory[]; watchPaths: readonly string[]}>> {
  root = await realpath(root)
  const repository = await runGit(root, ["rev-parse", "--show-toplevel"])
  if (repository.code !== 0 && !repository.error.includes("not a git repository")) throw new Error(repository.error)
  const gitRoot = repository.code === 0 ? await realpath(repository.output.trim()) : null
  const watchPaths = new Set<string>()
  const contractPathsByDirectory = new Map<string, readonly string[]>()
  const scenarioPathsByDirectory = new Map<string, readonly string[]>()
  const dependencyPathByDirectory = new Map<string, string>()
  if (gitRoot !== null) {
    for (let path = root;; path = dirname(path)) {
      watchPaths.add(join(path, ".gitignore"))
      if (path === gitRoot || dirname(path) === path) break
    }
  }
  const ignored = async (paths: readonly string[]): Promise<ReadonlySet<string>> => {
    if (gitRoot === null || paths.length === 0) return new Set()
    const result = await runGit(root, ["check-ignore", "--no-index", "--stdin", "-z"], paths.join("\0") + "\0")
    if (result.code !== 0 && result.code !== 1) throw new Error(result.error)
    return new Set(result.output.split("\0").filter(Boolean))
  }
  const visit = async (parent: string): Promise<readonly StorybookDirectory[]> => {
    watchPaths.add(parent)
    watchPaths.add(join(parent, ".gitignore"))
    const result: StorybookDirectory[] = []
    const entries = (await readdir(parent, {withFileTypes: true}))
      .filter(entry => entry.isDirectory() && !["src", "shared", ".git", "node_modules", ".storybook", "tests", "test"].includes(entry.name) && !packageRoots.has(join(parent, entry.name)))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    const excluded = await ignored(entries.map(entry => join(parent, entry.name)))
    for (const entry of entries) {
      const path = join(parent, entry.name)
      if (excluded.has(path)) continue
      const canonical = await realpath(path).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      if (canonical !== path) continue
      const packageJson = join(path, "package.json")
      watchPaths.add(packageJson)
      const packageInfo = await lstat(packageJson).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      if (packageInfo !== null) continue
      watchPaths.add(path)
      watchPaths.add(join(path, ".gitignore"))
      const entryPaths = [join(path, "index.tsx"), join(path, "index.ts")]
      for (const entryPath of entryPaths) watchPaths.add(entryPath)
      const ignoredEntries = await ignored(entryPaths)
      let publicEntry: string | undefined
      let moduleDocumentation
      for (const entryPath of entryPaths) {
        if (ignoredEntries.has(entryPath)) continue
        const info = await lstat(entryPath).catch(error => {
          if (error.code !== "ENOENT") throw error
          return null
        })
        if (!info?.isFile() || info.isSymbolicLink()) continue
        publicEntry = entryPath
        const file = await open(entryPath, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const metadata = await file.stat()
          if (!metadata.isFile() || metadata.size > 1_048_576) throw new Error(`Module documentation source exceeds limit or is not a file: ${entryPath}`)
          moduleDocumentation = readModuleDocumentation(await file.readFile("utf8"), entryPath)
        } finally { await file.close() }
        break
      }
      const sourcePath = join(path, "src")
      watchPaths.add(sourcePath)
      const sourceInfo = await lstat(sourcePath).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      const isModule = publicEntry === entryPaths[0] || (sourceInfo?.isDirectory() === true && !sourceInfo.isSymbolicLink())
      if (isModule) {
        const contractDirectory = join(path, "contract")
        const contractPaths = [join(contractDirectory, "input.ts"), join(contractDirectory, "output.ts")]
        for (const watched of [contractDirectory, ...contractPaths]) watchPaths.add(watched)
        const excludedContracts = await ignored([contractDirectory, ...contractPaths])
        const contractInfo = await lstat(contractDirectory).catch(error => {
          if (error.code !== "ENOENT") throw error
          return null
        })
        const foundContractPaths: string[] = []
        if (contractInfo?.isDirectory() && !contractInfo.isSymbolicLink() && !excludedContracts.has(contractDirectory)) {
          for (const contractPath of contractPaths) {
            if (excludedContracts.has(contractPath)) continue
            const info = await lstat(contractPath).catch(error => {
              if (error.code !== "ENOENT") throw error
              return null
            })
            if (!info?.isFile() || info.isSymbolicLink()) continue
            foundContractPaths.push(contractPath)
          }
        }
        if (foundContractPaths.length > 0) contractPathsByDirectory.set(path, Object.freeze(foundContractPaths))
        const specDirectory = join(path, "spec")
        const specPath = join(specDirectory, "deps.spec.ts")
        watchPaths.add(specDirectory)
        watchPaths.add(specPath)
        const excludedSpecs = await ignored([specDirectory, specPath])
        const directoryInfo = await lstat(specDirectory).catch(error => {
          if (error.code !== "ENOENT") throw error
          return null
        })
        if (directoryInfo?.isDirectory() && !directoryInfo.isSymbolicLink() && excludedSpecs.size === 0) {
          const specInfo = await lstat(specPath).catch(error => {
            if (error.code !== "ENOENT") throw error
            return null
          })
          if (specInfo?.isFile() && !specInfo.isSymbolicLink()) dependencyPathByDirectory.set(path, specPath)
        }
      }
      if (isModule || publicEntry !== undefined) {
        const specDirectory = join(path, "spec")
        watchPaths.add(specDirectory)
        const directoryInfo = await lstat(specDirectory).catch(error => {
          if (error.code !== "ENOENT") throw error
          return null
        })
        const scenarioPaths = [join(specDirectory, "scenario.spec.ts"), join(specDirectory, "scenario.spec.tsx")]
        for (const scenarioPath of scenarioPaths) watchPaths.add(scenarioPath)
        const excludedScenarios = await ignored([specDirectory, ...scenarioPaths])
        if (directoryInfo?.isDirectory() && !directoryInfo.isSymbolicLink() && !excludedScenarios.has(specDirectory)) {
          const found: string[] = []
          for (const scenarioPath of scenarioPaths) {
            if (excludedScenarios.has(scenarioPath)) continue
            const info = await lstat(scenarioPath).catch(error => {
              if (error.code !== "ENOENT") throw error
              return null
            })
            if (info?.isFile() && !info.isSymbolicLink()) found.push(scenarioPath)
          }
          if (found.length > 0) scenarioPathsByDirectory.set(path, Object.freeze(found))
        }
      }
      const children = isModule ? [] : await visit(path)
      result.push(Object.freeze({
        path,
        relativePath: relative(root, path),
        name: entry.name,
        ...(parent === root ? {} : {parentRelativePath: relative(root, parent)}),
        structuralRole: isModule ? "module" : children.some(child => child.structuralRole !== "directory") ? "category" : "directory",
        readmePath: null,
        ...(moduleDocumentation ? {moduleDocumentation} : {}),
      }))
      result.push(...children)
    }
    return Object.freeze(result)
  }
  const discovered = await visit(root)
  const contractPaths = [...contractPathsByDirectory.values()].flat()
  const dependencyPaths = [...dependencyPathByDirectory.values()]
  if (contractPaths.length > 0) onAnalysisSession("contract")
  const contracts = contractPaths.length === 0 ? new Map() : await readContractDocumentations(root, contractPaths)
  if (dependencyPaths.length > 0) onAnalysisSession("dependency")
  const dependencies = dependencyPaths.length === 0 ? new Map() : await readDependencySpecs(root, dependencyPaths)
  const directories = discovered.map(directory => {
    const ownedContracts = contractPathsByDirectory.get(directory.path) ?? []
    const sources = ownedContracts.flatMap(path => contracts.get(path)?.sources ?? [])
    for (const source of sources) watchPaths.add(source.sourcePath)
    const documents = ownedContracts.flatMap((path): import("../catalog/catalog.t.ts").StorybookContractDocument[] => {
      const contract = contracts.get(path)
      return contract === undefined ? [] : [{
        direction: basename(path) === "input.ts" ? "input" : "output",
        document: contract.document,
      }]
    })
    const scenarioPaths = scenarioPathsByDirectory.get(directory.path)
    const dependencyPath = dependencyPathByDirectory.get(directory.path)
    const dependencySpec = dependencyPath === undefined ? undefined : dependencies.get(dependencyPath)
    return Object.freeze({
      ...directory,
      ...(dependencySpec === undefined ? {} : {dependencySpec}),
      ...(scenarioPaths === undefined ? {} : {scenarioSpec: {sourcePaths: scenarioPaths}}),
      ...(documents.length === 0 ? {} : {contractDocumentation: {sources, documents}}),
    })
  })
  return Object.freeze({directories: Object.freeze(directories), watchPaths: Object.freeze([...watchPaths])})
}

async function runGit(cwd: string, args: readonly string[], input?: string) {
  const process = Bun.spawn(["git", "-C", cwd, ...args], {
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(10_000),
  })
  const [code, output, error] = await Promise.all([
    process.exited, new Response(process.stdout).text(), new Response(process.stderr).text(),
  ])
  return {code, output, error}
}
