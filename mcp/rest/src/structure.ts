import {dirname, relative, resolve, sep} from "node:path"
import {realpath} from "node:fs/promises"

/** Читает непосредственные публичные входы пакета; дерево маршрутов отдельно не хранится. */
export async function readChildren(directory: string) {
  const file = Bun.file(resolve(directory, "package.json"))
  if (!await file.exists()) return []
  const manifest = await file.json() as {exports?: Record<string, unknown>}
  const children: {name: string, path: string}[] = []
  for (const [key, entry] of Object.entries(manifest.exports ?? {})) {
    if (!/^\.\/[^/*]+$/u.test(key) || typeof entry !== "string") continue
    const path = await realpath(dirname(resolve(directory, entry)))
    const inside = relative(await realpath(directory), path)
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || inside.startsWith(sep)) continue
    children.push({name: key.slice(2), path})
  }
  return children
}

/** Разрешает узел только последовательным раскрытием существующих exports. */
export async function resolveArchetype(root: string, node: string): Promise<string | null> {
  const segments = node.split("/")
  if (segments.shift() !== "archetypes" || segments.some(value => !value || value === "." || value === "..")) return null
  let directory = await realpath(resolve(root, "archetypes"))
  for (const name of segments) {
    const child = (await readChildren(directory)).find(child => child.name === name)
    if (!child) return null
    directory = child.path
  }
  return directory
}

/** Сохраняет действующее чтение назначения из заметки либо README владельца. */
export async function readDescription(directory: string): Promise<string> {
  const readme = Bun.file(resolve(directory, "README.md"))
  let source = await readme.exists() ? await readme.text() : ""
  const overview = source.trim().split(/\r?\n\r?\n/u)[1]?.replace(/\s+/gu, " ").trim()
  if (overview && !overview.startsWith("#") && !overview.startsWith("```") && !overview.startsWith("- ")) return overview
  const note = source.match(/^- \[[^\]]+\]\(\.\/notes\/([a-z0-9-]+\.md)\)$/m)
  if (note?.[1]) source = await Bun.file(resolve(directory, "notes", note[1])).text()
  const paragraph = source.trim().split(/\r?\n\r?\n/u)[1]?.replace(/\s+/gu, " ").trim()
  return paragraph && !paragraph.startsWith("#") && !paragraph.startsWith("```") ? paragraph : ""
}

/** Находит единственный сценарный файл непосредственно у выбранного владельца. */
export async function findScenario(directory: string): Promise<string | null> {
  const candidates = []
  for (const name of ["scenario.spec.ts", "scenario.spec.tsx"]) {
    const path = resolve(directory, "spec", name)
    if (await Bun.file(path).exists()) {
      const actual = await realpath(path)
      if (actual !== path) throw new Error("Сценарий не может перенаправлять на другого владельца")
      candidates.push(path)
    }
  }
  if (candidates.length > 1) throw new Error("Спецификация содержит два сценарных файла")
  return candidates[0] ?? null
}
