/** Читает контракт через владельца TypeDoc, сохраняя ограничения источников Storybook. */
import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {open} from "node:fs/promises"
import {analyzeTypeDoc} from "@webxr/typedoc/parser"

export async function readContractDocumentation(root: string, path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let source: string
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 1_048_576) throw new Error(`Недопустимый размер контракта: ${path}`)
    source = await file.readFile("utf8")
  } finally { await file.close() }
  const result = await analyzeTypeDoc(root, path)
  const digest = createHash("sha256").update(source).digest("hex")
  if (!result.sources.some(entry => entry.path === path && entry.digest === digest)) {
    throw new Error(`Контракт изменился во время чтения: ${path}`)
  }
  return {document: result.document, sources: result.sources.map(entry => ({sourcePath: entry.path, sourceDigest: entry.digest}))}
}
