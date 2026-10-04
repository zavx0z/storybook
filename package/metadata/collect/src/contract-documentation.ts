/** Читает контракт через владельца TypeDoc, сохраняя ограничения источников Storybook. */
import {createHash} from "node:crypto"
import {basename} from "node:path"
import {constants} from "node:fs"
import {open, readFile} from "node:fs/promises"
import readModuleDocumentation from "@zavx0z/storybook-package-documentation"
import {analyzeTypeDoc} from "@zavx0z/immersive-typedoc/parser"
import {analyzeTypeDocs} from "@zavx0z/immersive-typedoc/batch"
import type {AnalyzeTypeDocOutput} from "@zavx0z/immersive-typedoc/parser"

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
  const results = await readContractDocumentationResults(root, paths)
  const documents = new Map<string, Awaited<ReturnType<typeof readContractDocumentation>>>()
  const failures: Error[] = []
  for (const result of results.values()) {
    if (result.ok) documents.set(result.path, result.value)
    else failures.push(result.error)
  }
  if (failures.length > 0) throw new AggregateError(failures, "Ошибки структурных контрактов")
  return documents
}

export type ContractDocumentationResult = Readonly<
  | {ok: true; path: string; value: Awaited<ReturnType<typeof readContractDocumentation>>}
  | {ok: false; path: string; error: Error}
>

/** Анализирует пути одной TypeDoc session и оставляет ошибки за каждым исходником. */
export async function readContractDocumentationResults(
  root: string,
  paths: readonly string[],
  onAnalysisSession: () => void = () => {},
): Promise<ReadonlyMap<string, ContractDocumentationResult>> {
  const sources = new Map<string, string>()
  const results = new Map<string, ContractDocumentationResult>()
  for (const path of paths) {
    try {
      sources.set(path, await readContractSource(path))
    } catch (error) {
      results.set(path, {ok: false, path, error: error instanceof Error ? error : new Error(String(error))})
    }
  }
  const ready = paths.filter(path => sources.has(path))
  if (ready.length === 0) return results
  onAnalysisSession()
  const batch = await analyzeTypeDocs({root, paths: ready})
  if (batch.results.length !== ready.length || batch.results.some((result, index) => result.path !== ready[index])) {
    throw new Error("TypeDoc batch вернул неполный набор результатов контрактов")
  }
  for (const result of batch.results) {
    if (!result.ok) {
      results.set(result.path, {ok: false, path: result.path, error: new Error(result.error)})
      continue
    }
    try {
      results.set(result.path, {
        ok: true,
        path: result.path,
        value: await validateContractDocumentation(result.path, sources.get(result.path)!, result.analysis),
      })
    } catch (error) {
      results.set(result.path, {ok: false, path: result.path, error: error instanceof Error ? error : new Error(String(error))})
    }
  }
  return results
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
  if (readModuleDocumentation({source, path})) throw new Error(`Контракт не должен содержать документацию пакета: ${path}`)
  const declarations = result.document.declarations
  const namespace = basename(path) === "index.ts" || declarations.some(declaration => declaration.name.includes("."))
  if (namespace) {
    const names = declarations.map(declaration => declaration.name.split("."))
    const owner = names[0]?.[0]
    if (declarations.length === 0 || names.some(parts => parts.length !== 2 || parts[0] !== owner
      || !["Input", "Output", "Slots"].includes(parts[1]!))
      || new Set(names.map(parts => parts[1])).size !== declarations.length) {
      throw new Error(`Контракт должен раскрывать роли одного namespace: ${path}`)
    }
  } else if (declarations.length !== 1) {
    throw new Error(`Контракт должен экспортировать ровно один основной interface или type: ${path}`)
  }
  for (const declaration of declarations) {
    if (!["interface", "type"].includes(declaration.kind)
      || !source.includes(declaration.signature)
      || !namespace && !/^export\s+(?:default\s+)?(?:declare\s+)?(?:interface|type)\s/u.test(declaration.signature)
      || /\bextends\b[\s\S]*\{\s*\}$/u.test(declaration.signature)) {
      throw new Error(`Основной контракт должен быть объявлен в самом файле: ${path}`)
    }
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
