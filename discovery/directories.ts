import {constants} from "node:fs"
import {lstat, open, readdir, realpath} from "node:fs/promises"
import {readModuleDocumentation} from "./module-documentation.ts"
import {readDependencySpec} from "./dependency-spec.ts"
import {readContractDocumentation} from "./contract-documentation.ts"
import {dirname, join, relative} from "node:path"
import type {StorybookDirectory} from "../catalog/catalog.t.ts"

/** Обходит категории до публичного index.tsx, собственного src или отдельного пакета. */
export async function discoverStorybookDirectories(
  root: string,
  packageRoots: ReadonlySet<string>,
): Promise<Readonly<{directories: readonly StorybookDirectory[]; watchPaths: readonly string[]}>> {
  root = await realpath(root)
  const repository = await runGit(root, ["rev-parse", "--show-toplevel"])
  if (repository.code !== 0 && !repository.error.includes("not a git repository")) throw new Error(repository.error)
  const gitRoot = repository.code === 0 ? await realpath(repository.output.trim()) : null
  const watchPaths = new Set<string>()
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
      let dependencySpec
      let contractDocumentation
      if (isModule) {
        const contractDirectory = join(path, "contract")
        const contractPaths = [join(contractDirectory, "input.ts"), join(contractDirectory, "output.ts")]
        for (const watched of [contractDirectory, ...contractPaths]) watchPaths.add(watched)
        const excludedContracts = await ignored([contractDirectory, ...contractPaths])
        const contractInfo = await lstat(contractDirectory).catch(error => {
          if (error.code !== "ENOENT") throw error
          return null
        })
        const sources = []
        const documents: import("../catalog/catalog.t.ts").StorybookContractDocument[] = []
        if (contractInfo?.isDirectory() && !contractInfo.isSymbolicLink() && !excludedContracts.has(contractDirectory)) {
          for (const [index, contractPath] of contractPaths.entries()) {
            if (excludedContracts.has(contractPath)) continue
            const info = await lstat(contractPath).catch(error => {
              if (error.code !== "ENOENT") throw error
              return null
            })
            if (!info?.isFile() || info.isSymbolicLink()) continue
            const document = await readContractDocumentation(root, contractPath)
            sources.push(...document.sources)
            for (const source of document.sources) watchPaths.add(source.sourcePath)
            documents.push({direction: index === 0 ? "input" : "output", document: document.document})
          }
        }
        if (sources.length > 0) contractDocumentation = {sources, documents}
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
          if (specInfo?.isFile() && !specInfo.isSymbolicLink()) dependencySpec = await readDependencySpec(root, specPath)
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
        ...(dependencySpec ? {dependencySpec} : {}),
        ...(contractDocumentation ? {contractDocumentation} : {}),
      }))
      result.push(...children)
    }
    return Object.freeze(result)
  }
  const directories = await visit(root)
  return Object.freeze({directories, watchPaths: Object.freeze([...watchPaths])})
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
