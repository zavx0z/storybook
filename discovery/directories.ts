import {constants} from "node:fs"
import {lstat, open, readdir, realpath} from "node:fs/promises"
import {readModuleDocumentation} from "./module-documentation.ts"
import {dirname, join, relative} from "node:path"
import type {StorybookDirectory} from "../catalog/catalog.t.ts"

/** Reads category trees, stopping at module src and independent package boundaries. */
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
      const entryPath = join(path, "index.ts")
      watchPaths.add(entryPath)
      const info = await lstat(entryPath).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      let moduleDocumentation
      if (info?.isFile() && !info.isSymbolicLink() && !(await ignored([entryPath])).has(entryPath)) {
        const file = await open(entryPath, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const metadata = await file.stat()
          if (!metadata.isFile() || metadata.size > 1_048_576) throw new Error(`Module documentation source exceeds limit or is not a file: ${entryPath}`)
          moduleDocumentation = readModuleDocumentation(await file.readFile("utf8"), entryPath)
        } finally { await file.close() }
      }
      const sourcePath = join(path, "src")
      watchPaths.add(sourcePath)
      const sourceInfo = await lstat(sourcePath).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      const isModule = sourceInfo?.isDirectory() === true && !sourceInfo.isSymbolicLink()
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
