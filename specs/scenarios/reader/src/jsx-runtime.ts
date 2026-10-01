/**
Определяет JSX transport по source pragma и tsconfig; preload может объявлять свой protocol.
Не содержит привязки к конкретному компоненту или headless-реализации.

@packageDocumentation
*/
import {dirname, resolve} from "node:path"
import Compiler from "@build/compiler"

/** Возвращает единственный runtime; неоднозначные preload требуют исправления конфигурации пакета. */
export async function findJsxRuntime(resolvedPreloads: readonly string[], sourcePath?: string): Promise<string | undefined> {
  if (sourcePath !== undefined) {
    const sourceProtocol = Compiler.resolveStorybookJsxImportSource(sourcePath)
    if (sourceProtocol !== undefined) return sourceProtocol
  }
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
