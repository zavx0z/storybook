/**
Находит служебную директорию спецификации у непосредственного владельца.

@packageDocumentation
*/
import {lstat} from "node:fs/promises"
import {resolve} from "node:path"


/**
Проверяет только непосредственную дочернюю директорию spec.
Проверки содержимого выполняются отдельно пакетом валидатора.

@param path - Путь к директории поиска; относительный путь считается от cwd.
@returns Абсолютный путь к spec либо null, если директории нет.
Файлы и символические ссылки с именем spec не считаются директорией спецификации.
@throws Ошибки файловой системы, кроме отсутствия пути.
*/
export async function findSpec(path: string): Promise<string | null> {
  const candidate = resolve(path, "spec")
  try {
    const info = await lstat(candidate)
    if (!info.isDirectory()) return null
    return candidate
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return null
    throw error
  }
}
