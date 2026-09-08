import {lstat, readdir, realpath} from "node:fs/promises"
import {dirname, join, relative} from "node:path"
import type {StorybookDirectory} from "../catalog/catalog.t.ts"

/** Reads ordinary directories without crossing package boundaries or following symlinks. */
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
      .filter(entry => entry.isDirectory() && !["src", ".git", "node_modules", ".storybook", "tests", "test"].includes(entry.name) && !packageRoots.has(join(parent, entry.name)))
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
      const readme = join(path, "README.md")
      const info = await lstat(readme).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      const hiddenReadme = info === null ? false : (await ignored([readme])).has(readme)
      result.push(Object.freeze({
        path,
        relativePath: relative(root, path),
        name: entry.name,
        readmePath: info?.isFile() && !info.isSymbolicLink() && !hiddenReadme ? readme : null,
        children: await visit(path),
      }))
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
