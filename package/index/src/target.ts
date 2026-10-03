import {lstat, readFile, realpath} from "node:fs/promises"
import {basename, dirname, relative, resolve, sep} from "node:path"
import type {ArchetypesPackageIndex} from "../contract"
import type {ExportTarget} from "./targets"
import {collectTargets} from "./targets"

/** Находит точный публичный вход фактического вложенного владельца; частные файлы не открывает. */
async function forwardedOwner(root: string, target: string): Promise<ArchetypesPackageIndex.Output["entries"][number]["owner"]> {
  const absolute = resolve(root, target)
  const parts = relative(root, dirname(absolute)).split(sep)
  let current = root
  let owner: {path: string, manifest: Record<string, unknown>} | undefined
  for (const part of parts) {
    current = resolve(current, part)
    const info = await lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    })
    if (!info) return undefined
    if (!info.isDirectory() || info.isSymbolicLink()) return undefined
    const metadata = resolve(current, "package.json")
    const file = await lstat(metadata).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    })
    if (file?.isSymbolicLink()) return undefined
    if (file?.isFile()) {
      const manifest: unknown = JSON.parse(await readFile(metadata, "utf8"))
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return undefined
      owner = {path: current, manifest: manifest as Record<string, unknown>}
    }
  }
  if (!owner || typeof owner.manifest.name !== "string") return undefined
  const declared = owner.manifest.exports
  const exports = typeof declared === "string" ? {".": declared}
    : declared && typeof declared === "object" && !Array.isArray(declared) ? declared as Record<string, unknown> : {}
  const entry = collectTargets(exports).targets.find(entry => entry.target !== null
    && entry.target.startsWith("./") && resolve(owner!.path, entry.target) === absolute)
  if (!entry || await fileStatus(owner.path, `./${relative(owner.path, absolute)}`) !== "owned") return undefined
  return {path: await realpath(owner.path), name: owner.manifest.name, export: entry.path}
}

/** Останавливает чтение на символической ссылке или границе вложенного пакета. */
async function fileStatus(root: string, target: string): Promise<ArchetypesPackageIndex.Output["entries"][number]["status"]> {
  const parts = relative(root, resolve(root, target)).split(sep)
  if (parts[0] === ".." || !target.startsWith("./")) return "outside-package"
  let current = root
  try {
    for (const [index, part] of parts.entries()) {
      current = resolve(current, part)
      const info = await lstat(current)
      if (info.isSymbolicLink()) return "symlink"
      if (index === parts.length - 1) return info.isFile() ? "owned" : "missing"
      if (!info.isDirectory()) return "missing"
      try {
        const metadata = await lstat(resolve(current, "package.json"))
        if (metadata.isSymbolicLink()) return "symlink"
        if (metadata.isFile()) return "nested-package"
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
    }
    return "missing"
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"
    throw error
  }
}

/** Читает точную цель и соседние контракты, не следуя в код другого владельца. */
export async function readTarget(root: string, declared: ExportTarget): Promise<ArchetypesPackageIndex.Output["entries"][number]> {
  const {target} = declared
  let status = target === null ? "blocked" : await fileStatus(root, target)
  const owner = status === "nested-package" && target !== null ? await forwardedOwner(root, target) : undefined
  if (owner) status = "forwarded"
  const code = target !== null && /\.[cm]?[jt]sx?$/u.test(target)
  const entrypoint = code && (status === "owned" || status === "forwarded")
  let input: string | null = null
  let output: string | null = null
  if (target !== null && (status === "owned" || status === "forwarded") && entrypoint) {
    const directory = dirname(target)
    const name = basename(target).replace(/\.[cm]?[jt]sx?$/u, "")
    const contractPath = `./${relative(root, resolve(root, directory, `contract/${name}.ts`)).split(sep).join("/")}`
    const inputPath = `./${relative(root, resolve(root, directory, "contract/input.ts")).split(sep).join("/")}`
    const outputPath = `./${relative(root, resolve(root, directory, "contract/output.ts")).split(sep).join("/")}`
    const base = owner?.path ?? root
    const canonicalRoot = owner ? await realpath(root) : root
    const contract = await fileStatus(base, `./${relative(base, resolve(canonicalRoot, contractPath))}`) === "owned"
    input = contract ? contractPath
      : await fileStatus(base, `./${relative(base, resolve(canonicalRoot, inputPath))}`) === "owned" ? inputPath : null
    output = contract ? contractPath
      : await fileStatus(base, `./${relative(base, resolve(canonicalRoot, outputPath))}`) === "owned" ? outputPath : null
  }
  return {...declared, status, code, entrypoint, input, output, ...(owner ? {owner} : {})}
}
