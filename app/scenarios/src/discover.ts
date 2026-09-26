/**
Собирает приватные настройки запуска из пути сценария и файлов его владельца.
Публичному вызывающему коду эти настройки передавать не требуется.

@packageDocumentation
*/
import {dirname, resolve} from "node:path"
import {readPreloads} from "./preloads"
import {findJsxRuntime} from "./jsx-runtime"
import {readImports} from "./imports"

/** Находит ближайший package.json, не выходя за корень файловой системы. */
async function findOwner(path: string): Promise<string> {
  let cwd = dirname(path)
  while (!await Bun.file(resolve(cwd, "package.json")).exists()) {
    const parent = dirname(cwd)
    if (parent === cwd) throw new Error(`Не найден package.json для ${path}`)
    cwd = parent
  }
  return cwd
}

/** Определяет рабочую директорию, компилятор и наблюдаемые импорты без запуска теста. */
export async function discover(path: string) {
  const cwd = await findOwner(path)
  const preload = await readPreloads(cwd, path)
  const jsxImportSource = await findJsxRuntime(preload)
  const observe = await readImports(path)
  return {path, cwd, preload, jsxImportSource, observe}
}
