/**
Определяет JSX transport по публичному jsx-runtime export пакета preload.
Не содержит привязки к конкретному компоненту или headless-реализации.

@packageDocumentation
*/
import {dirname, resolve} from "node:path"

/** Возвращает единственный runtime; неоднозначные preload требуют исправления конфигурации пакета. */
export async function findJsxRuntime(resolvedPreloads: readonly string[]): Promise<string | undefined> {
  let jsxImportSource: string | undefined
  for (const entry of resolvedPreloads) {
    let directory = dirname(entry)
    while (!await Bun.file(resolve(directory, "package.json")).exists()) {
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    const ownerFile = Bun.file(resolve(directory, "package.json"))
    if (!await ownerFile.exists()) continue
    const owner = await ownerFile.json()
    if (owner.exports?.["./jsx-runtime"]) {
      if (jsxImportSource && jsxImportSource !== owner.name) throw new Error("Неоднозначный JSX runtime в preload сценария")
      jsxImportSource = owner.name
    }
  }
  return jsxImportSource
}
