/**
Читает контракты и сценарии выбранного владельца для его предметного MCP.
Проверяет происхождение готовых схем и не исполняет исходники сценариев.

@packageDocumentation
*/
import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {open} from "node:fs/promises"
import type {ContractSchema, McpContentSources} from "./contract/types"
import type {StorybookAppKnowledgeContent as Contract} from "./contract"

export type {StorybookAppKnowledgeContent} from "./contract"

/**
Раскрывает JSON Schema контрактов и сценарии только выбранного владельца.
Описание и форма схемы принадлежат разбору TypeDoc; чтение ничего не исполняет.
*/
export default async function readMcpContent(sources: Contract.Input = {}, documents?: Readonly<Record<string, Readonly<{path: string}>>>): Promise<Contract.Output> {
  if (documents !== undefined) {
    for (const key of ["input", "output", "slots"] as const) {
      if (sources[key] !== undefined && documents[key]?.path !== sources[key].path) throw new Error(`Источник ${key} отсутствует в декларации`)
    }
    for (const [index, path] of (sources.scenarios ?? []).entries()) {
      if (documents[`scenario.${index + 1}`]?.path !== path) throw new Error("Источник сценария отсутствует в декларации")
    }
  }
  const [input, output, slots, scenarios] = await Promise.all([
    readSchema(sources.input),
    readSchema(sources.output),
    readSchema(sources.slots),
    sources.scenarios && Promise.all(sources.scenarios.map(path => readSource(path))),
  ])
  return {
    ...(input === undefined ? {} : {input}),
    ...(output === undefined ? {} : {output}),
    ...(slots === undefined ? {} : {slots}),
    ...(scenarios?.length ? {scenarios} : {}),
  }
}

/** Проверяет актуальность выбранного контракта перед выдачей его готовой схемы. */
async function readSchema(source: McpContentSources["input"]): Promise<ContractSchema | undefined> {
  if (source === undefined) return undefined
  if (source.schema === undefined) throw new Error("Для контракта ещё не подготовлена JSON Schema")
  await readSource(source.path, source.digest)
  return structuredClone(source.schema)
}

/** Читает обычный файл; изменившийся контракт должен сначала пройти обнаружение каталога. */
async function readSource(path: string, digest?: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 1_048_576) throw new Error("Исходник должен быть обычным файлом размером до 1 МиБ")
    const source = await file.readFile("utf8")
    if (digest !== undefined && createHash("sha256").update(source).digest("hex") !== digest) {
      throw new Error("Контракт изменился; каталог ещё не подтвердил новую редакцию")
    }
    return source
  } finally {
    await file.close()
  }
}
