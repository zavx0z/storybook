/**
Раскрывает состав пакетов Repo либо принадлежащую выбранному пакету часть состава.

Чтение не исполняет код пакета и не создаёт общее дерево маршрутов.
Результат одинаково используют структурное обнаружение и Route.

@packageDocumentation
*/
import {Glob} from "bun"
import {lstat, readFile, realpath} from "node:fs/promises"
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import type {StorybookPackageRouteWorkspaces} from "./contract"
import {validateWorkspacePatterns} from "./src/validate-patterns.ts"

export type {StorybookPackageRouteWorkspaces} from "./contract"

/**
Раскрывает корневые workspaces без чтения кода пакетов.
Если value не передан, находит декларацию Repo и выбирает вложенные пакеты root.

Порядок шаблонов и лексикографический порядок совпадений сохраняются;
исключения, symlink и выход за корень проверяются при каждом чтении.

@param input - Канонизируемый корень пакета и значение `package.json#workspaces`.
@returns Найденные непосредственные package roots и пути наблюдения.
@throws Ошибка при недопустимом шаблоне, symlink или выходе за корень.
*/
export default async function readWorkspacePackages({root, value}: StorybookPackageRouteWorkspaces.Input): Promise<StorybookPackageRouteWorkspaces.Output> {
  root = await realpath(root)
  if (value === undefined) {
    const selected = root
    for (let owner = selected; ; owner = dirname(owner)) {
      const path = join(owner, "package.json")
      const info = await lstat(path).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      if (info?.isFile() && !info.isSymbolicLink()) {
        const metadata = JSON.parse(await readFile(path, "utf8"))
        if (metadata.workspaces !== undefined) {
          const workspace = await readWorkspacePackages({root: owner, value: metadata.workspaces})
          const registered = owner === selected || workspace.roots.includes(selected)
          return Object.freeze({
            roots: Object.freeze(registered ? workspace.roots.filter(path => path.startsWith(`${selected}${sep}`)) : []),
            inputs: Object.freeze([...new Set([path, ...workspace.inputs])]),
          })
        }
      }
      const boundary = await lstat(join(owner, ".git")).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      if (boundary || dirname(owner) === owner) break
    }
    return Object.freeze({roots: Object.freeze([]), inputs: Object.freeze([selected])})
  }
  const patterns = validateWorkspacePatterns(value)
  const exclusions = patterns.filter(pattern => pattern.startsWith("!"))
    .map(pattern => new Glob(pattern.slice(1)))
  const roots = new Set<string>()
  const inputs = new Set([root])
  const admitted = (path: string) => !path.split("/").some(part => part === "node_modules" || part === ".git" || part === "meta") &&
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
        if (info.isDirectory()) {
          inputs.add(absolute)
          inputs.add(join(absolute, "package.json"))
        }
      }
    }
    const matches: string[] = []
    for await (const metadataPath of new Glob(`${pattern}/package.json`).scan({cwd: root, onlyFiles: false, followSymlinks: false})) {
      const path = dirname(metadataPath)
      if (path === "." || !admitted(path)) continue
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
      inputs.add(metadata)
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
      inputs.add(dirname(path))
    }
  }
  return Object.freeze({roots: Object.freeze([...roots]), inputs: Object.freeze([...inputs].sort())})
}
