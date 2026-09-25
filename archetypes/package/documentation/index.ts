/**
Извлекает обзор модуля из начального TSDoc исходника без исполнения TypeScript.
Комментарии сущностей после первого выражения не становятся обзором модуля.

@packageDocumentation
*/
import {createHash} from "node:crypto"
import {renderModuleComment} from "./src/render-comment"
import type {ReadModuleDocumentationInput} from "./contract/input"
import type {ReadModuleDocumentationOutput} from "./contract/output"

export type {ReadModuleDocumentationInput, ReadModuleDocumentationOutput}

const MAX_MODULE_SOURCE_BYTES = 1024 * 1024

/**
Читает только начальные комментарии модуля и возвращает Markdown отмеченного блока.

@param source - Исходник, не превышающий 1 МиБ в UTF-8.
@param path - Путь источника для диагностики и происхождения результата.
@returns Документация с digest исходника либо null, если отмеченного блока нет.
@throws RangeError, если исходник превышает допустимый размер.
@throws Error, если до первого выражения расположено несколько модульных блоков.
*/
export function readModuleDocumentation({source, path}: ReadModuleDocumentationInput): ReadModuleDocumentationOutput | null {
  if (Buffer.byteLength(source, "utf8") > MAX_MODULE_SOURCE_BYTES) {
    throw new RangeError(`Module source exceeds ${MAX_MODULE_SOURCE_BYTES} bytes: ${path}`)
  }
  const comments: string[] = []
  let rest = source.replace(/^\uFEFF/u, "").replace(/^#![^\n]*(?:\n|$)/u, "")
  while (true) {
    rest = rest.trimStart()
    if (rest.startsWith("//")) {
      const end = rest.indexOf("\n")
      if (end < 0) break
      rest = rest.slice(end + 1)
      continue
    }
    if (!rest.startsWith("/*")) break
    const end = rest.indexOf("*/", 2)
    if (end < 0) break
    if (rest.startsWith("/**")) comments.push(rest.slice(3, end))
    rest = rest.slice(end + 2)
  }
  const documents = comments.flatMap(comment => {
    const markdown = renderModuleComment(comment)
    return markdown === null ? [] : [markdown]
  })
  if (documents.length > 1) throw new Error(`Multiple module documentation blocks: ${path}`)
  return documents[0] === undefined ? null : Object.freeze({
    sourcePath: path,
    sourceDigest: createHash("sha256").update(source).digest("hex"),
    markdown: documents[0],
  })
}
