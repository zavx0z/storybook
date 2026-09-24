import {lstat, readdir, realpath} from "node:fs/promises"
import {isAbsolute, relative, resolve, sep} from "node:path"

const privateNames = new Set([
  "src",
  "shared",
  "spec",
  "fixture",
  ".git",
  "node_modules",
  "tests",
  "test",
])

/** Возвращает realpath обычной non-symlink директории. */
export async function readExactDirectory(path: string): Promise<string | null> {
  const absolutePath = resolve(path)
  try {
    const info = await lstat(absolutePath)
    if (!info.isDirectory() || info.isSymbolicLink()) return null
    const canonical = await realpath(absolutePath)
    return canonical === absolutePath ? canonical : null
  } catch {
    return null
  }
}

/** Читает только допустимые имена immediate directories до анализа markers. */
export async function readDirectoryCandidates(
  parent: string,
  name: string | undefined,
  packagePaths: readonly string[],
): Promise<readonly {readonly name: string; readonly path: string}[]> {
  const packagePathSet = new Set(packagePaths.map(path => resolve(path)))
  return (await readdir(parent, {withFileTypes: true}))
    .filter(entry => entry.isDirectory()
      && (name === undefined || entry.name === name)
      && !entry.name.startsWith(".")
      && !privateNames.has(entry.name)
      && !packagePathSet.has(resolve(parent, entry.name)))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .map(entry => ({name: entry.name, path: resolve(parent, entry.name)}))
}

/** Проверяет markers, определяющие public entry и module boundary директории. */
export async function readDirectoryShape(
  path: string,
  ignored: ReadonlySet<string>,
): Promise<{readonly entry: "tsx" | "ts" | null; readonly module: boolean}> {
  const tsxPath = resolve(path, "index.tsx")
  const tsPath = resolve(path, "index.ts")
  const hasTsx = !ignored.has(tsxPath) && await isExactFile(tsxPath)
  const hasTs = !ignored.has(tsPath) && await isExactFile(tsPath)
  const source = await lstat(resolve(path, "src")).catch(() => null)
  const hasSource = source?.isDirectory() === true && !source.isSymbolicLink()
  return {
    entry: hasTsx ? "tsx" : hasTs ? "ts" : null,
    module: hasTsx || hasSource,
  }
}

/** Проверяет существование любого directory entry без перехода по нему. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/** Определяет принадлежность пути указанному owner root. */
export function isContained(rootPath: string, path: string): boolean {
  const difference = relative(rootPath, path)
  return difference === "" || (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference))
}

/** Проверяет обычный non-symlink файл index. */
async function isExactFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    return info.isFile() && !info.isSymbolicLink()
  } catch {
    return false
  }
}
