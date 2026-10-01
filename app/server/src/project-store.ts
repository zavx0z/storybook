import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from "node:fs"
import {dirname, isAbsolute} from "node:path"
import {homedir} from "node:os"
import {join, resolve} from "node:path"
import {randomUUID} from "node:crypto"

export type StorybookProjectSelection = readonly string[]

export function storybookProjectSelectionPath(): string {
  return join(resolve(Bun.env.STORYBOOK_CONFIG_ROOT ?? join(homedir(), ".storybook")), "projects.json")
}

/** Постоянный выбор пользователя, отдельный от PID, transport и артефактов сборки. */
export function readStorybookProjectSelection(path: string): StorybookProjectSelection | null {
  if (!existsSync(path)) return null
  const roots = strings(JSON.parse(readFileSync(path, "utf8")))
  if (roots.some(root => !isAbsolute(root))) throw new Error("Storybook project paths must be absolute")
  return roots
}

/** Атомарно заменяет только выбор проектов; содержимое репозиториев не изменяется. */
export function writeStorybookProjectSelection(path: string, selection: StorybookProjectSelection): void {
  mkdirSync(dirname(path), {recursive: true, mode: 0o700})
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(selection, null, 2) + "\n", {mode: 0o600, flag: "wx"})
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, {force: true})
  }
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.trim() === "")) {
    throw new Error("Invalid Storybook project selection list")
  }
  if (new Set(value).size !== value.length) throw new Error("Duplicate Storybook project selection")
  return Object.freeze([...value])
}
