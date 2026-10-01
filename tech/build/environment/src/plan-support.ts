import {lstatSync, readFileSync, realpathSync, statSync} from "node:fs"
import {basename, dirname, join, relative, resolve, sep} from "node:path"

const resolvedToolchainFiles = new Map<string, readonly string[]>()

/** Находит владельца адаптера компилятора, не включая соседний монорепозиторий целиком. */
export function compilerOwnerRoot(adapterPath: string): string {
  let directory = dirname(adapterPath)
  while (true) {
    if (lstatFile(join(directory, "package.json"))) return canonicalDirectory(directory)
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`Cannot find Storybook compiler adapter owner: ${adapterPath}`)
}

/**
Находит существующие `node_modules` между owner roots и ближайшими Git roots.

Каталоги ограничивают допустимые зависимости: их полный inventory не читается и не
хешируется. Это покрывает обычный поиск Bun из вложенного workspace package к
hoisted dependency root до того, как metafile назовёт exact resolved file.
*/
export function workspaceResolutionGuardRoots(ownerRoots: readonly string[]): readonly string[] {
  const guards = new Set<string>()
  for (const value of ownerRoots) {
    const root = canonicalDirectory(value)
    const boundary = nearestRepositoryRoot(root) ?? root
    let directory = root
    while (inside(boundary, directory)) {
      const modules = join(directory, "node_modules")
      if (directoryExists(modules)) guards.add(canonicalDirectory(modules))
      if (directory === boundary) break
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  return Object.freeze([...guards])
}

/** Возвращает ближайший checkout root, не переходя к соседним repositories. */
function nearestRepositoryRoot(path: string): string | null {
  let directory = path
  while (true) {
    if (pathExists(join(directory, ".git"))) return canonicalDirectory(directory)
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/** Проверяет существующий каталог без создания resolver state. */
function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Проверяет filesystem entry любого допустимого вида. */
function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** Находит манифест и вход фактически установленного TypeScript. */
export function toolchainFiles(toolRoot: string): readonly string[] {
  const cached = resolvedToolchainFiles.get(toolRoot)
  if (cached !== undefined) return cached
  const entry = canonicalExactFile(Bun.resolveSync("typescript", toolRoot))
  let directory = dirname(entry)
  while (true) {
    const manifest = join(directory, "package.json")
    if (lstatFile(manifest)) {
      const value = JSON.parse(readFileSync(manifest, "utf8")) as unknown
      if (isObject(value) && value.name === "typescript") {
        const files = Object.freeze([canonicalExactFile(manifest), entry])
        resolvedToolchainFiles.set(toolRoot, files)
        return files
      }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`Cannot find TypeScript toolchain owner for ${entry}`)
}

/** Проверяет обычный файл без следования символьной ссылке в последнем сегменте. */
export function canonicalExactFile(value: string): string {
  const parent = realpathSync.native(dirname(resolve(value)))
  const path = join(parent, basename(value))
  const stats = lstatSync(path)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Storybook fingerprint input must be an exact non-symlink file: ${path}`)
  }
  return path
}

/** Разрешает существующий каталог в его канонический физический путь. */
export function canonicalDirectory(value: string): string {
  const path = realpathSync.native(resolve(value))
  if (!statSync(path).isDirectory()) throw new Error(`Storybook fingerprint root must be a directory: ${path}`)
  return path
}

/** Проверяет возможный манифест без исключения при его отсутствии. */
function lstatFile(path: string): boolean {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

/** Отличает JSON-объект от массива и примитива. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** Проверяет вложенность пути с учётом регистра файловой системы хоста. */
function inside(root: string, path: string): boolean {
  const local = relative(comparablePath(root), comparablePath(path))
  return local === "" || (!local.startsWith(`..${sep}`) && local !== ".." && !local.startsWith(sep))
}

/** Нормализует сравнение путей, сохраняя фактическую идентичность возвращаемых данных. */
function comparablePath(value: string): string {
  const path = resolve(value)
  return process.platform === "darwin" || process.platform === "win32" ? path.toLowerCase() : path
}
