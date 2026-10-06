import declareEnvironment from "@zavx0z/storybook-app-environment-declaration"
/**
Выбирает инструменты предметной сущности и закрепляет их за областью назначения.
Package предоставляет общий набор, предметный владелец добавляет свои возможности.
Вызов не меняет область, не запускает AI HTTP и не исполняет произвольные импорты.

@packageDocumentation
*/
import bindTools from "@zavx0z/storybook-app-environment-binding"
import createWorkspace from "@zavx0z/ai-workspace"
import ToolError from "@zavx0z/ai-tech-failure"
import type {StorybookAppEnvironmentTools as Contract} from "./contract"
export type {StorybookAppEnvironmentTools} from "./contract"


/** Создаёт самостоятельную область; изменение cwd или адреса чтения её не меняет. */
export default function createEntityTools({directory, type, extensions, declaration}: Contract.Input): Contract.Output {
  const workspace = createWorkspace({directory})
  const tools = bindTools({workspace, declaration: declaration ?? declareEnvironment({directory, ...(type === undefined ? {} : {type})}),
    ...(extensions === undefined ? {} : {extensions})})
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  return Object.freeze({
    list: () => tools.map(({execute: _execute, ...description}) => structuredClone(description)),
    async call(command, signal, onProgress) {
      signal?.throwIfAborted()
      if (command === null || typeof command !== "object" || Array.isArray(command)
        || Object.keys(command).some(key => key !== "name" && key !== "arguments")) {
        throw new ToolError("INVALID_INPUT", "Ожидается команда {name, arguments}")
      }
      const {name, arguments: args} = command as Record<string, unknown>
      if (typeof name !== "string" || args === null || typeof args !== "object" || Array.isArray(args)) {
        throw new ToolError("INVALID_INPUT", "Нужны имя инструмента и объект arguments")
      }
      const tool = byName.get(name)
      if (tool === undefined) throw new ToolError("UNKNOWN_TOOL", "Инструмент недоступен в этой области", 404)
      try {
        const result = await tool.execute(args, {signal: signal ?? new AbortController().signal, ...(onProgress === undefined ? {} : {onProgress})})
        if (result === null || typeof result !== "object" || Array.isArray(result)) {
          throw new ToolError("INVALID_RESULT", "Инструмент должен вернуть объект", 500)
        }
        return result as Record<string, unknown>
      } catch (error) {
        throw ToolError.from(error)
      }
    },
  })
}
