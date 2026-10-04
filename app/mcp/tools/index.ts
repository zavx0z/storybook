/**
Выбирает инструменты предметной сущности и закрепляет их за областью подключения.
Package предоставляет общий набор, предметный MCP добавляет свои возможности.
Вызов не меняет область, не запускает AI HTTP и не исполняет произвольные импорты.

@packageDocumentation
*/
import createWorkspace from "@zavx0z/ai-workspace"
import ToolError from "@zavx0z/ai-tech-failure"
import packageMcp from "@zavx0z/storybook-package-mcp"
import project from "@zavx0z/storybook-project-mcp"
import repo from "@zavx0z/storybook-repo-mcp"
import component from "@zavx0z/storybook-component-mcp"
import container from "@zavx0z/storybook-container-mcp"
import cluster from "@zavx0z/storybook-cluster-mcp"
import domain from "@zavx0z/storybook-domain-mcp"
import type {StorybookAppMcpTools as Contract} from "./contract"
export type {StorybookAppMcpTools} from "./contract"

const owners = {Project: project, Repo: repo, Component: component, Container: container, Cluster: cluster, Domain: domain}

/** Создаёт самостоятельную область; изменение cwd или адреса чтения её не меняет. */
export default function createEntityTools({directory, type}: Contract.Input): Contract.Output {
  const workspace = createWorkspace({directory})
  const tools = (type === undefined ? packageMcp : owners[type]).tools({workspace})
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  return Object.freeze({
    list: () => tools.map(({execute: _execute, ...description}) => structuredClone(description)),
    async call(command, signal) {
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
        const result = await tool.execute(args)
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
