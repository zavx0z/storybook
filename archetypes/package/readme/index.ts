/**
Читает авторский обзор непосредственно выбранного пакета.
Отсутствие обзора отличается от пустого файла; содержимое Markdown сохраняется.

@packageDocumentation
*/
import {readFile, lstat} from "node:fs/promises"
import {resolve} from "node:path"
import type {ReadPackageReadmeInput} from "./contract/input"
import type {ReadPackageReadmeOutput} from "./contract/output"

export type {ReadPackageReadmeInput, ReadPackageReadmeOutput}

/**
Возвращает текст обычного README.md без подстановки обзора родителя.

@param path - Директория пакета; относительный путь разрешается от cwd.
@returns Текст, в том числе пустой, или null при отсутствии обычного файла.
@throws Ошибки доступа и чтения, кроме отсутствия файла.
*/
export async function readPackageReadme({path}: ReadPackageReadmeInput): Promise<ReadPackageReadmeOutput> {
  const source = resolve(path, "README.md")
  try {
    const file = await lstat(source)
    return {content: file.isFile() ? await readFile(source, "utf8") : null}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {content: null}
    throw error
  }
}
