import {createHash} from "node:crypto"
import {lstat, readFile, realpath} from "node:fs/promises"
import {dirname, isAbsolute, relative, resolve, sep} from "node:path"
import type {Project} from "typescript/unstable/async"
import type {SourceFile} from "typescript/unstable/ast"
import type {Declaration, Diagnostic} from "../contract/declaration"

/** Кэши ограничены одним TypeScript snapshot и не сохраняют native handles между чтениями. */
export interface Context {
  readonly project: Project
  readonly root: string
  readonly entryPath?: string
  readonly owners: Map<string, Promise<Declaration["owner"]>>
  readonly sources: Map<string, {path: string, digest: string}>
  readonly diagnostics: Diagnostic[]
}

/** Проверяет принадлежность пути без совпадений по общему строковому префиксу. */
export function inside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === "" || child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

/** Находит ближайший физический package owner исходного объявления. */
export function ownerOf(path: string, context: Context): Promise<Declaration["owner"]> {
  const directory = dirname(path)
  const cached = context.owners.get(directory)
  if (cached) return cached
  const pending = (async () => {
    for (let current = directory; ; current = dirname(current)) {
      const metadata = resolve(current, "package.json")
      const info = await lstat(metadata).catch(error => {
        if (error.code === "ENOENT") return null
        throw error
      })
      if (info?.isFile() && !info.isSymbolicLink()) {
        const value = JSON.parse(await readFile(metadata, "utf8"))
        return typeof value.name === "string" ? {name: value.name, path: await realpath(current)} : null
      }
      if (dirname(current) === current) return null
    }
  })()
  context.owners.set(directory, pending)
  return pending
}

/** Сохраняет digest текста snapshot; последующая проверка обнаруживает изменение файла во время чтения. */
export function rememberSource(source: SourceFile, context: Context): void {
  context.sources.set(source.fileName, {
    path: source.fileName,
    digest: createHash("sha256").update(source.text).digest("hex"),
  })
}

/** Добавляет одну диагностику на точный код, путь и сообщение. */
export function diagnose(context: Context, code: string, path: string, message: string, severity: Diagnostic["severity"] = "error"): void {
  if (!context.diagnostics.some(item => item.code === code && item.path === path && item.message === message && item.severity === severity)) {
    context.diagnostics.push({severity, code, path, message})
  }
}
