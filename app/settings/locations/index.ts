/**
Хранит расположение проектов и репозиториев на машине пользователя.
Первое чтение создаёт конфиг с незаданными путями и оставляет выбор человеку. Изменение путей
не создаёт проекты, не перемещает исходники и не меняет текущие назначения.

@packageDocumentation
*/
import {randomUUID} from "node:crypto"
import {link, lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile} from "node:fs/promises"
import {homedir} from "node:os"
import {isAbsolute, join, resolve} from "node:path"
import type {StorybookAppSettingsLocations} from "./contract"

export type {StorybookAppSettingsLocations} from "./contract"

/**
Открывает локальный конфиг приложения.
@param input - Необязательная домашняя директория для изолированного исполнения.
@returns Чтение с созданием пустого конфига и сохранение двух пользовательских путей.
@throws TypeError при повреждённом конфиге или недопустимом пути.
*/
export default function createLocations(input: StorybookAppSettingsLocations.Input = {}): StorybookAppSettingsLocations.Output {
  const home = input.home ?? homedir()
  if (!isAbsolute(home)) throw new TypeError("Домашний каталог должен быть абсолютным")
  const directory = join(home, ".zavx0z")
  const file = join(directory, "config.json")
  /** Создаёт закрытый каталог конфига и отвергает подмену символической ссылкой. */
  const ensureDirectory = async () => {
    await mkdir(directory, {recursive: true, mode: 0o700})
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("Каталог конфига должен быть обычным каталогом")
  }
  /**
  Публикует полностью записанный пустой конфиг, только если путь ещё свободен.
  Конкурирующее создание или сохранение сохраняет свой файл; временный файл удаляется.
  */
  const initialize = async () => {
    await ensureDirectory()
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify({repositoriesDirectory: null, projectsDirectory: null}, null, 2)}\n`, {flag: "wx", mode: 0o600})
      try { await link(temporary, file) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      }
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error })
    }
  }
  /** Читает пользовательские пути, при отсутствии файла сначала создаёт пустой конфиг. */
  const read = async () => {
    let value: unknown
    try { value = JSON.parse(await readFile(file, "utf8")) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      await initialize()
      value = JSON.parse(await readFile(file, "utf8"))
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Повреждён конфиг расположения")
    const field = (key: string): string | null => {
      const path = Reflect.get(value, key)
      if (path === undefined || path === null || path === "") return null
      if (typeof path !== "string" || !isAbsolute(path)) throw new TypeError(`Некорректный путь ${key}`)
      return path
    }
    return {repositoriesDirectory: field("repositoriesDirectory"), projectsDirectory: field("projectsDirectory")}
  }
  const canonical = async (path: string): Promise<string> => {
    if (typeof path !== "string" || !path.trim() || path.includes("\0")) throw new TypeError("Укажите путь к каталогу")
    const expanded = path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path
    if (!isAbsolute(expanded)) throw new TypeError("Укажите абсолютный путь к каталогу")
    const result = await realpath(resolve(expanded))
    if (!(await stat(result)).isDirectory()) throw new TypeError("Путь должен указывать на каталог")
    return result
  }
  return {
    read,
    async update(value) {
      const next = {repositoriesDirectory: await canonical(value.repositoriesDirectory), projectsDirectory: await canonical(value.projectsDirectory)}
      await ensureDirectory()
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {flag: "wx", mode: 0o600})
        await rename(temporary, file)
      } finally {
        await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error })
      }
      return next
    },
  }
}
