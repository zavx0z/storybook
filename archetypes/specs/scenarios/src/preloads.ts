/**
Определяет preload из bunfig и подходящей команды bun test в scripts.test.
Shell-команды не исполняются. Поддержаны явные пути и директории без glob/substitution.

@packageDocumentation
*/
import {relative, resolve} from "node:path"

/** Объединяет test.preload с preload команды, выбирающей данный файл. */
export async function readPreloads(cwd: string, path: string): Promise<string[]> {
  const manifest = await Bun.file(resolve(cwd, "package.json")).json()
  const preload = new Set<string>()
  const config = Bun.file(resolve(cwd, "bunfig.toml"))
  if (await config.exists()) {
    const parsed = Bun.TOML.parse(await config.text()) as {test?: {preload?: string | string[]}}
    const values = parsed.test?.preload
    for (const value of typeof values === "string" ? [values] : values ?? []) preload.add(value)
  }
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
    const local = relative(cwd, path)
    if (!targets.length || targets.some((target: string) => local === target || local.startsWith(`${target.replace(/\/$/, "")}/`))) {
      for (const value of values) preload.add(value)
    }
  }
  return [...preload].map(value => Bun.resolveSync(value.startsWith(".") ? resolve(cwd, value) : value, cwd))
}
