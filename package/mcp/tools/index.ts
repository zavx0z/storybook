/**
Предоставляет файловые инструменты для назначенной области Package.
Импортирует реализации и подготовленные описания AI напрямую, без HTTP-сервера.
Сущность дополняет базовый набор; повтор имени отвергается до выполнения.

@packageDocumentation
*/
import type {StorybookPackageMcpTools as Contract} from "./contract"
import {filesystem} from "./src/filesystem"
export type {StorybookPackageMcpTools} from "./contract"

/** Связывает общий набор и расширения с контекстом одной агентской сессии. */
export default function createPackageTools({workspace, extensions = []}: Contract.Input): Contract.Output {
  const tools = [...filesystem(workspace), ...extensions]
  const names = new Set<string>()
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`Повтор имени инструмента: ${tool.name}`)
    names.add(tool.name)
  }
  return Object.freeze(tools.map(tool => Object.freeze(tool)))
}
