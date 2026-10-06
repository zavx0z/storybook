/**
Читает контракты и сценарии выбранного владельца для его предметного MCP.
Проверяет происхождение готовых схем и не исполняет исходники сценариев.

@packageDocumentation
*/
import access from "@zavx0z/storybook-package-resources-access"
import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {open} from "node:fs/promises"
import type {StorybookAppKnowledgeContent as Contract} from "./contract"

export type {StorybookAppKnowledgeContent} from "./contract"

/**
Раскрывает JSON Schema контрактов и сценарии только выбранного владельца.
Описание и форма схемы принадлежат разбору TypeDoc; чтение ничего не исполняет.
*/
export default async function readMcpContent(sources: Contract.Input = {}, documents?: Readonly<Record<string, Readonly<{package?: string, path: string}>>>, directory?: string): Promise<Contract.Output> {
  if (documents !== undefined) {
    for (const key of ["input", "output", "slots"] as const) {
      if (sources[key] !== undefined && documents[key] === undefined) throw new Error(`Источник ${key} отсутствует в декларации`)
    }
    for (const [index] of (sources.scenarios ?? []).entries()) {
      if (documents[`scenario.${index + 1}`] === undefined) throw new Error("Источник сценария отсутствует в декларации")
    }
  }
  const resources = documents === undefined ? undefined : access(directory === undefined ? {} : {directory})
  const declared = (key: string, path: string, digest?: string): Promise<string> => {
    if (documents === undefined) return readSource(path, digest)
    const text = resources!.read(documents[key]!)
    verify(text, digest)
    return Promise.resolve(text)
  }
  const schema = async (key: "input" | "output" | "slots") => {
    const source = sources[key]
    if (source === undefined) return undefined
    if (source.schema === undefined) throw new Error("Для контракта ещё не подготовлена JSON Schema")
    await declared(key, source.path, source.digest)
    return structuredClone(source.schema)
  }
  const [input, output, slots, scenarios] = await Promise.all([
    schema("input"),
    schema("output"),
    schema("slots"),
    sources.scenarios && Promise.all(sources.scenarios.map((path, index) => declared(`scenario.${index + 1}`, path))),
  ])
  return {
    ...(input === undefined ? {} : {input}),
    ...(output === undefined ? {} : {output}),
    ...(slots === undefined ? {} : {slots}),
    ...(scenarios?.length ? {scenarios} : {}),
  }
}

/** Сверяет реальный текст с сохранённой редакцией схемы. */
function verify(source: string, digest?: string): void {
  if (Buffer.byteLength(source) > 1_048_576) throw new Error("Исходник должен быть размером до 1 МиБ")
  if (digest !== undefined && createHash("sha256").update(source).digest("hex") !== digest) {
    throw new Error("Контракт изменился; каталог ещё не подтвердил новую редакцию")
  }
}

/** Читает обычный файл; изменившийся контракт должен сначала пройти обнаружение каталога. */
async function readSource(path: string, digest?: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 1_048_576) throw new Error("Исходник должен быть обычным файлом размером до 1 МиБ")
    const source = await file.readFile("utf8")
    verify(source, digest)
    return source
  } finally {
    await file.close()
  }
}
