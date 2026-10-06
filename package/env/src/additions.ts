import {lstatSync, readdirSync, readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {join, resolve, relative, sep} from "node:path"
import type {StorybookPackageEnv as Contract} from "../contract"

function exists(path: string) {
  try { return lstatSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}
function directory(path: string): boolean {
  const info = exists(path)
  if (info === undefined) return false
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Каталог окружения должен принадлежать пакету: ${path}`)
  return true
}
function file(path: string): string {
  const info = exists(path)
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Отсутствует обычный исходник окружения: ${path}`)
  return path
}

/** Обнаруживает только собственные дополнения; содержимое и исполняемый код не читает. */
export function additions(root?: string): Contract.Output {
  const rules: Record<string, Contract.Output["rules"][string]> = {}
  const tools: Record<string, Contract.Output["tools"][string]> = {}
  if (root === undefined) return {rules, documents: {}, tools}
  const assigned = resolve(fileURLToPath(new URL("../../../", import.meta.url)), root)
  const base = join(assigned, ".agent")
  if (!directory(base)) return {rules, documents: {}, tools}
  const ruleRoot = join(base, "rules")
  if (directory(ruleRoot)) for (const entry of readdirSync(ruleRoot, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.endsWith(".md")) rules[entry.name.slice(0, -3)] = {path: relative(assigned, file(join(ruleRoot, entry.name))).split(sep).join("/")}
  }
  const toolRoot = join(base, "tools")
  if (directory(toolRoot)) for (const entry of readdirSync(toolRoot, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue
    if (entry.isSymbolicLink()) throw new Error(`Ссылка вместо собственного инструмента: ${entry.name}`)
    if (!entry.isDirectory()) continue
    const owner = join(toolRoot, entry.name)
    const manifest = file(join(owner, "package.json"))
    if (lstatSync(manifest).size > 1_048_576) throw new Error(`Слишком большой манифест инструмента: ${entry.name}`)
    const metadata = JSON.parse(readFileSync(manifest, "utf8"))
    if (typeof metadata.name !== "string" || metadata.exports?.["."] !== "./index.ts") {
      throw new Error(`Инструмент ${entry.name} должен объявлять публичный index.ts`)
    }
    directory(join(owner, "contract")) || missing(owner, "contract")
    file(join(owner, "contract/index.ts"))
    directory(join(owner, "spec")) || missing(owner, "spec")
    file(join(owner, "spec/scenario.spec.ts"))
    file(join(owner, "index.ts"))
    file(join(owner, "description.json"))
    tools[entry.name] = {implementation: {package: `./.agent/tools/${entry.name}`, export: "."}, description: {package: `./.agent/tools/${entry.name}`, path: "description.json"}}
  }
  return {rules, documents: {}, tools}
}
function missing(owner: string, part: string): never {
  throw new Error(`Инструмент ${owner} не содержит ${part}`)
}
