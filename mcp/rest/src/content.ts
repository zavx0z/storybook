import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {open} from "node:fs/promises"
import type {StorybookContractDocument} from "../../../catalog/catalog.t"

/** Схема из того же TypeDoc-разбора, который используется каталогом и интерфейсом. */
type ContractSchema = NonNullable<StorybookContractDocument["document"]["declarations"][number]["schema"]>

/** Проверенные каталогом исходники выбранного владельца; пути остаются внутри сервера. */
export interface McpContentSources {
  readonly input?: {readonly path: string, readonly digest: string, readonly schema?: ContractSchema}
  readonly output?: {readonly path: string, readonly digest: string, readonly schema?: ContractSchema}
  readonly scenarios?: readonly string[]
}

/**
Раскрывает JSON Schema контрактов и сценарии только выбранного владельца.
Описание и форма схемы принадлежат разбору TypeDoc; чтение ничего не исполняет.
*/
export async function readMcpContent(sources: McpContentSources = {}) {
  const [input, output, scenarios] = await Promise.all([
    readSchema(sources.input),
    readSchema(sources.output),
    sources.scenarios && Promise.all(sources.scenarios.map(path => readSource(path))),
  ])
  return {
    ...(input === undefined ? {} : {input}),
    ...(output === undefined ? {} : {output}),
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
