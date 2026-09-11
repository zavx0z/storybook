/** Читает контракт через владельца TypeDoc, сохраняя ограничения источников Storybook. */
import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {open, readFile} from "node:fs/promises"
import {readModuleDocumentation} from "./module-documentation.ts"
import {analyzeTypeDoc} from "@webxr/typedoc/parser"
import {analyzeTypeDocs} from "@webxr/typedoc/batch"
import type {AnalyzeTypeDocOutput} from "@webxr/typedoc/parser/contract/output"

export async function readContractDocumentation(root: string, path: string) {
  const source = await readContractSource(path)
  const result = await analyzeTypeDoc({root, path})
  return await validateContractDocumentation(path, source, result)
}

/** Читает несколько contract-файлов одной TypeDoc session и сохраняет локальные результаты по пути. */
export async function readContractDocumentations(
  root: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, Awaited<ReturnType<typeof readContractDocumentation>>>> {
  const sources = new Map<string, string>()
  for (const path of paths) sources.set(path, await readContractSource(path))
  const batch = await analyzeTypeDocs({root, paths})
  const documents = new Map<string, Awaited<ReturnType<typeof readContractDocumentation>>>()
  const failures: Error[] = []
  for (const result of batch.results) {
    if (!result.ok) {
      failures.push(new Error(result.error))
      continue
    }
    try {
      documents.set(result.path, await validateContractDocumentation(result.path, sources.get(result.path)!, result.analysis))
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Ошибки структурных контрактов")
  return documents
}

async function readContractSource(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 1_048_576) throw new Error(`Недопустимый размер контракта: ${path}`)
    return await file.readFile("utf8")
  } finally { await file.close() }
}

async function validateContractDocumentation(
  path: string,
  source: string,
  result: AnalyzeTypeDocOutput,
) {
  if (readModuleDocumentation(source, path)) throw new Error(`Контракт не должен содержать документацию пакета: ${path}`)
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
  for (const source of result.sources) {
    const current = await readFile(source.path).catch(() => null)
    if (current === null || createHash("sha256").update(current).digest("hex") !== source.digest) {
      throw new Error(`Источник контракта изменился во время чтения: ${source.path}`)
    }
  }
  return {document: result.document, sources: result.sources.map(entry => ({sourcePath: entry.path, sourceDigest: entry.digest}))}
}
