/** Читает контракт через владельца TypeDoc, сохраняя ограничения источников Storybook. */
import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {open} from "node:fs/promises"
import {readModuleDocumentation} from "./module-documentation.ts"
import {analyzeTypeDoc} from "@webxr/typedoc/parser"

export async function readContractDocumentation(root: string, path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let source: string
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 1_048_576) throw new Error(`Недопустимый размер контракта: ${path}`)
    source = await file.readFile("utf8")
  } finally { await file.close() }
  if (readModuleDocumentation(source, path)) throw new Error(`Контракт не должен содержать документацию пакета: ${path}`)
  const result = await analyzeTypeDoc({root, path})
  if (result.document.declarations.length !== 1 || result.document.declarations[0]!.kind !== "interface") {
    throw new Error(`Контракт должен экспортировать ровно один interface: ${path}`)
  }
  const declaration = result.document.declarations[0]!
  if (!/^export\s+(?:default\s+)?(?:declare\s+)?interface\s/u.test(declaration.signature) || !source.includes(declaration.signature) || /\bextends\b[\s\S]*\{\s*\}$/u.test(declaration.signature)) {
    throw new Error(`Интерфейс должен быть объявлен в самом контракте: ${path}`)
  }
  const digest = createHash("sha256").update(source).digest("hex")
  if (!result.sources.some(entry => entry.path === path && entry.digest === digest)) {
    throw new Error(`Контракт изменился во время чтения: ${path}`)
  }
  return {document: result.document, sources: result.sources.map(entry => ({sourcePath: entry.path, sourceDigest: entry.digest}))}
}
