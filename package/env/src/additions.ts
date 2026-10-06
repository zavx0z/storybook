import {lstatSync, readdirSync, readFileSync} from "node:fs"
import {join, resolve} from "node:path"
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
function file(path: string): Contract.Output["rules"][string] {
  const info = exists(path)
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Отсутствует обычный исходник окружения: ${path}`)
  return {path}
}

/** Обнаруживает только собственные дополнения; содержимое и исполняемый код не читает. */
export function additions(root?: string): Contract.Output {
  const rules: Record<string, Contract.Output["rules"][string]> = {}
  const tools: Record<string, Contract.Output["tools"][string]> = {}
  if (root === undefined) return {rules, documents: {}, tools}
  const base = join(resolve(root), ".agent")
  if (!directory(base)) return {rules, documents: {}, tools}
  const ruleRoot = join(base, "rules")
  if (directory(ruleRoot)) for (const entry of readdirSync(ruleRoot, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.endsWith(".md")) rules[entry.name.slice(0, -3)] = file(join(ruleRoot, entry.name))
  }
  const toolRoot = join(base, "tools")
  if (directory(toolRoot)) for (const entry of readdirSync(toolRoot, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue
    if (entry.isSymbolicLink()) throw new Error(`Ссылка вместо собственного инструмента: ${entry.name}`)
    if (!entry.isDirectory()) continue
    const owner = join(toolRoot, entry.name)
    const manifest = file(join(owner, "package.json"))
    if (lstatSync(manifest.path).size > 1_048_576) throw new Error(`Слишком большой манифест инструмента: ${entry.name}`)
    const metadata = JSON.parse(readFileSync(manifest.path, "utf8"))
    if (typeof metadata.name !== "string" || metadata.exports?.["."] !== "./index.ts"
      || metadata.exports?.["./description.json"] !== "./description.json") {
      throw new Error(`Инструмент ${entry.name} должен объявлять публичные index.ts и description.json`)
    }
    directory(join(owner, "contract")) || missing(owner, "contract")
    file(join(owner, "contract/index.ts"))
    directory(join(owner, "spec")) || missing(owner, "spec")
    file(join(owner, "spec/scenario.spec.ts"))
    tools[entry.name] = {implementation: file(join(owner, "index.ts")), description: file(join(owner, "description.json"))}
  }
  return {rules, documents: {}, tools}
}
function missing(owner: string, part: string): never {
  throw new Error(`Инструмент ${owner} не содержит ${part}`)
}
