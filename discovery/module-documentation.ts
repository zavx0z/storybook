/**
Извлекает Markdown из начального TSDoc модуля без исполнения TypeScript.
Читаются только комментарии до первого выражения; документация сущностей
и строки исходника не становятся описанием модуля.

@packageDocumentation
*/
import {createHash} from "node:crypto"
import type {StorybookModuleDocumentation} from "../catalog/catalog.t.ts"

export function readModuleDocumentation(source: string, path: string): StorybookModuleDocumentation | null {
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
    let marked = false
    let fence: string | null = null
    const rawLines = comment.split(/\r?\n/u)
    const decorated = rawLines.slice(1).filter(line => line.trim()).every(line => /^\s*\*/u.test(line))
    const lines = rawLines.map(line => decorated ? line.replace(/^\s*\* ?/u, "") : line)
    const rendered = lines.map(line => {
      const delimiter = line.trimStart().match(/^(`{3,}|~{3,})/u)?.[1]
      if (delimiter) {
        if (fence === null) fence = delimiter
        else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null
        return line
      }
      if (fence !== null) return line
      if (/^\s*@packageDocumentation\s*$/u.test(line)) { marked = true; return "" }
      return line.replace(/^\s*@remarks\s*/u, "")
        .replace(/^\s*@example\s*/u, "\n### Пример\n\n")
        .replace(/^\s*@see\s+/u, "\nСм. также: ")
    })
    const markdown = rendered.join("\n").trim()
    return marked && markdown ? [markdown] : []
  })
  if (documents.length > 1) throw new Error(`Multiple module documentation blocks: ${path}`)
  return documents[0] === undefined ? null : Object.freeze({
    sourcePath: path,
    sourceDigest: createHash("sha256").update(source).digest("hex"),
    markdown: documents[0],
  })
}
