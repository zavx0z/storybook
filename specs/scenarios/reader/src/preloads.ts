/**
Определяет preload тестовой среды: явные настройки пакета имеют приоритет,
иначе используется ближайшее объявление test.preload внутри репозитория.
Shell-команды не исполняются. Поддержаны явные пути и директории без glob/substitution.

@packageDocumentation
*/
import {lstat} from "node:fs/promises"
import {basename, dirname, relative, resolve} from "node:path"

/** undefined означает отсутствие настройки; [] — явный отказ от preload. */
async function configuredPreloads(directory: string): Promise<string[] | undefined> {
  const file = Bun.file(resolve(directory, "bunfig.toml"))
  if (!await file.exists()) return undefined
  const parsed = Bun.TOML.parse(await file.text()) as {test?: {preload?: unknown}}
  const value = parsed.test?.preload
  if (value === undefined) return undefined
  if (typeof value === "string") return [value]
  if (Array.isArray(value) && value.every(item => typeof item === "string")) return value
  throw new TypeError(`test.preload должен быть строкой или списком строк: ${directory}`)
}

function resolvePreloads(values: readonly string[], directory: string): string[] {
  return values.map(value => Bun.resolveSync(value.startsWith(".") ? resolve(directory, value) : value, directory))
}

/** Сохраняет собственную среду пакета либо наследует общую до загрузки его статических импортов. */
export async function readPreloads(cwd: string, path: string): Promise<string[]> {
  const manifest = await Bun.file(resolve(cwd, "package.json")).json()
  const local = await configuredPreloads(cwd)
  const preload = new Set(resolvePreloads(local ?? [], cwd))
  let explicitScript = false
  const script = typeof manifest.scripts?.test === "string" ? manifest.scripts.test : ""
  for (const command of script.split(/&&|\|\||;/)) {
    if (!/^\s*bun\s+test\b/.test(command)) continue
    const tokens = command.trim().match(/"[^"]*"|'[^']*'|\S+/g)?.map((token: string) => token.replace(/^['"]|['"]$/g, "")) ?? []
    const values: string[] = []
    const targets: string[] = []
    for (let i = 2; i < tokens.length; i++) {
      const token = tokens[i]!
      if (token === "--preload") { values.push(tokens[++i]!); continue }
      if (token.startsWith("--preload=")) { values.push(token.slice(10)); continue }
      if (!token.startsWith("-")) targets.push(token)
    }
    const localPath = relative(cwd, path)
    if (!targets.length || targets.some((target: string) => {
      const selected = relative(cwd, resolve(cwd, target))
      return localPath === selected || localPath.startsWith(`${selected.replace(/\/$/, "")}/`)
    })) {
      if (values.length > 0) explicitScript = true
      for (const value of resolvePreloads(values, cwd)) preload.add(value)
    }
  }
  if (local !== undefined || explicitScript) return [...preload]

  let directory = resolve(cwd)
  while (true) {
    const git = await lstat(resolve(directory, ".git")).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    })
    const parent = dirname(directory)
    if (git !== null || parent === directory || basename(parent) === "node_modules") return []
    directory = parent
    const inherited = await configuredPreloads(directory)
    if (inherited !== undefined) return [...new Set(resolvePreloads(inherited, directory))]
  }
}
