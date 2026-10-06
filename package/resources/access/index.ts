/**
Предоставляет доступ к файлам пакетов и их публичным модулям по переносимым ссылкам.
Файлы читаются относительно владельца и состава files; модули разрешаются через
exports. Физические пути остаются внутри связанного читателя.

@packageDocumentation
*/
import {createRequire} from "node:module"
import {dirname, resolve, join, relative, isAbsolute, sep} from "node:path"
import {existsSync, lstatSync, realpathSync, readFileSync, openSync, closeSync, fstatSync, constants} from "node:fs"
import {pathToFileURL} from "node:url"
import identity from "@zavx0z/storybook-package-identity"
import type {StorybookPackageResourcesAccess as Contract} from "./contract"
export type {StorybookPackageResourcesAccess} from "./contract"

function inside(root: string, path: string): boolean {
  const local = relative(root, path)
  return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local)
}
function localPath(path: string): string {
  if (!path || isAbsolute(path) || /^[A-Za-z]:/u.test(path) || path.includes("\\") || path.split("/").includes("..") || /[\u0000-\u001f]/u.test(path)) {
    throw new Error("Нужен относительный путь внутри пакета")
  }
  return path
}
function manifest(root: string) {
  const path = join(root, "package.json")
  if (lstatSync(path).size > 1_048_576) throw new Error("Манифест пакета превышает бюджет")
  return JSON.parse(readFileSync(path, "utf8")) as {name?: string, files?: string[], main?: string, exports?: unknown}
}
function read(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error("Ресурс должен быть обычным файлом до 8 МиБ")
    const text = readFileSync(fd, "utf8")
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error("Ресурс превышает бюджет")
    return text
  } finally { closeSync(fd) }
}

/** Создаёт читатель без импорта исполняемых модулей или загрузки содержимого ресурсов. */
export default function access({directory = process.cwd()}: Contract.Input = {}): Contract.Output {
  const assigned = realpathSync(directory)
  const roots = new Map<string, string>()
  const locate = (name: string): string => {
    if (name.startsWith("./")) {
      const target = realpathSync(resolve(assigned, localPath(name)))
      if (!inside(assigned, target)) throw new Error("Пакет находится вне назначенной области")
      manifest(target)
      return target
    }
    identity.package(name, "Имя пакета")
    const cached = roots.get(name)
    if (cached !== undefined) return cached
    for (const origin of [assigned, import.meta.dir]) {
      for (let current = origin;; current = dirname(current)) {
        if (existsSync(join(current, "package.json")) && manifest(current).name === name) {
          roots.set(name, current)
          return current
        }
        if (dirname(current) === current) break
      }
      const require = createRequire(pathToFileURL(join(origin, "__resource_resolver__.cjs")))
      for (const folder of require.resolve.paths(name) ?? []) {
        const candidate = join(folder, name)
        if (existsSync(join(candidate, "package.json")) && manifest(candidate).name === name) {
          const root = realpathSync(candidate)
          roots.set(name, root)
          return root
        }
      }
    }
    throw new Error(`Не найден подключённый пакет: ${name}`)
  }
  const file = (source: Parameters<Contract.Output["read"]>[0]) => {
    const root = source.package === undefined ? assigned : locate(source.package)
    const path = localPath(source.path)
    const target = realpathSync(resolve(root, path))
    if (!inside(root, target)) throw new Error("Файл находится вне своего пакета")
    if (source.package !== undefined) {
      const metadata = manifest(root)
      const relativePath = relative(root, target).split(sep).join("/")
      const always = relativePath === "package.json" || /^(?:readme|licen[cs]e)(?:\.[^/]*)?$/iu.test(relativePath) || metadata.main === relativePath
      if (metadata.files !== undefined && !always && !metadata.files.some(pattern => {
        const clean = pattern.replace(/^\.\//u, "").replace(/\/$/u, "")
        return relativePath === clean || relativePath.startsWith(`${clean}/`) || new Bun.Glob(clean).match(relativePath)
      })) throw new Error(`Файл отсутствует в files пакета ${source.package}: ${path}`)
    }
    return target
  }
  const module = (source: Parameters<Contract.Output["load"]>[0]) => {
    const root = locate(source.package)
    const metadata = manifest(root)
    const key = source.export
    if (key !== "." && !key.startsWith("./")) throw new Error("Нужен публичный адрес экспорта")
    if (key !== ".") localPath(key)
    if (metadata.exports === undefined || typeof metadata.name !== "string") throw new Error("Модуль должен иметь явный exports")
    const specifier = metadata.name + (key === "." ? "" : key.slice(1))
    const target = realpathSync(Bun.resolveSync(specifier, root))
    if (!inside(root, target)) throw new Error("Экспорт указывает вне своего пакета")
    return target
  }
  return {
    read: source => read(file(source)),
    source: source => read(module(source)),
    load: async source => import(pathToFileURL(module(source)).href),
  }
}
