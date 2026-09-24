import {lstat} from "node:fs/promises"
import {basename, dirname, relative, resolve, sep} from "node:path"
import type {ReadPackageIndexOutput} from "../contract/output"
import type {ExportTarget} from "./targets"

/** Останавливает чтение на символической ссылке или границе вложенного пакета. */
async function fileStatus(root: string, target: string): Promise<ReadPackageIndexOutput["entries"][number]["status"]> {
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
        if ((await lstat(resolve(current, "package.json"))).isFile()) return "nested-package"
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
export async function readTarget(root: string, declared: ExportTarget): Promise<ReadPackageIndexOutput["entries"][number]> {
  const {target} = declared
  const status = target === null ? "blocked" : await fileStatus(root, target)
  const code = target !== null && /\.[cm]?[jt]sx?$/u.test(target)
  const entrypoint = target !== null && /^(index\.ts|index\.tsx)$/u.test(basename(target))
  let input: string | null = null
  let output: string | null = null
  if (target !== null && status === "owned" && entrypoint) {
    const directory = dirname(target)
    const inputPath = `./${relative(root, resolve(root, directory, "contract/input.ts")).split(sep).join("/")}`
    const outputPath = `./${relative(root, resolve(root, directory, "contract/output.ts")).split(sep).join("/")}`
    input = await fileStatus(root, inputPath) === "owned" ? inputPath : null
    output = await fileStatus(root, outputPath) === "owned" ? outputPath : null
  }
  return {...declared, status, code, entrypoint, input, output}
}
