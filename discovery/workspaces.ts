import {Glob} from "bun"
import {lstat, realpath} from "node:fs/promises"
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path"

/** Expands owner workspace patterns with Bun; never reads installed dependency state. */
export async function discoverWorkspacePackages(root: string, value: unknown): Promise<Readonly<{
  roots: readonly string[]
  watchPaths: readonly string[]
}>> {
  if (!Array.isArray(value) || value.some(pattern => typeof pattern !== "string" || pattern.length === 0)) {
    throw new Error("package.json workspaces must be an array of non-empty patterns")
  }
  root = await realpath(root)
  const patterns = value as string[]
  for (const pattern of patterns) {
    const path = pattern.startsWith("!") ? pattern.slice(1) : pattern
    if (!path || path === "." || path === "./" || isAbsolute(path) || path.includes("\\") || /(^|[/,{])\.\.($|[/,}])/u.test(path)) {
      throw new Error(`Workspace pattern must stay inside the project: ${pattern}`)
    }
  }
  const exclusions = patterns.filter(pattern => pattern.startsWith("!"))
    .map(pattern => new Glob(pattern.slice(1)))
  const roots = new Set<string>()
  const watchPaths = new Set([root])
  const admitted = (path: string) => !path.split("/").some(part => part === "node_modules" || part === ".git") &&
    !exclusions.some(pattern => pattern.match(path) || pattern.match(`${path}/`))
  for (const pattern of patterns.filter(pattern => !pattern.startsWith("!"))) {
    // Observe intermediate directories too, including those whose final package does not exist yet.
    const prefixes = pattern.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"))
    for (const prefix of prefixes) {
      for await (const path of new Glob(prefix).scan({cwd: root, onlyFiles: false, followSymlinks: false})) {
        if (!admitted(path)) continue
        const absolute = resolve(root, path)
        const info = await lstat(absolute)
        if (info.isSymbolicLink()) throw new Error(`Workspace directory must not be a symlink: ${absolute}`)
        if (info.isDirectory()) watchPaths.add(absolute)
      }
    }
    const matches: string[] = []
    for await (const path of new Glob(pattern).scan({cwd: root, onlyFiles: false, followSymlinks: false})) {
      if (!admitted(path)) continue
      const absolute = resolve(root, path)
      const info = await lstat(absolute)
      if (info.isSymbolicLink()) throw new Error(`Workspace directory must not be a symlink: ${absolute}`)
      if (!info.isDirectory()) continue
      const canonical = await realpath(absolute)
      const within = relative(root, canonical)
      if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
        throw new Error(`Workspace package must be strictly inside the project: ${absolute}`)
      }
      const metadata = join(canonical, "package.json")
      watchPaths.add(metadata)
      const file = await lstat(metadata).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      if (file === null) continue
      if (!file.isFile() || file.isSymbolicLink()) throw new Error(`Workspace package.json must be an exact file: ${metadata}`)
      matches.push(canonical)
    }
    // Pattern order is authored; matches within one pattern have stable path order.
    for (const path of matches.sort()) {
      roots.add(path)
      watchPaths.add(dirname(path))
    }
  }
  return Object.freeze({roots: Object.freeze([...roots]), watchPaths: Object.freeze([...watchPaths].sort())})
}
