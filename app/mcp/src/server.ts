/**
Регистрирует предметное чтение, управление и ресурсы в одном native MCP server.
Предметные инструкции и структура ответа принадлежат HTTP-серверу.
Общая очистка служебных данных, один отложенный контроллер и обработка контекста
каждого запроса сохраняются на публичной границе MCP.
*/
import {McpServer} from "@modelcontextprotocol/server"
import {randomUUID} from "node:crypto"
import {register} from "./subject"
import {registerStorybookResources} from "./resources"
import createControl from "@zavx0z/storybook-app-control"
import {recordMcpRequest, traceMcpRequest} from "./request-log"
import {controllerAccessor} from "./controller"
import {retainRequestLifetime} from "./lifetime"
import {invoke} from "./invoke"
import {resultContent, captureContent} from "./response"
import response from "@zavx0z/storybook-app-mcp-response"
import createRequestProgress from "@zavx0z/storybook-tech-mcp-progress"
import type {StorybookAppMcp} from "../contract"

export function createServer(options: StorybookAppMcp.Input = {}): ReturnType<StorybookAppMcp.Output["createServer"]> {
  const agentId = randomUUID()
  const record = options.recordRequest ?? recordMcpRequest
  options = {...options, recordRequest: entry => record({...entry, agentId})}
  const server = new McpServer({name: "storybook", version: "1.0.0"})
  const run = retainRequestLifetime(server)
  const controller = controllerAccessor(options, run)
  /** Исполняет управляющую операцию с отменой и progress текущего MCP-запроса. */
  const execute: Parameters<NonNullable<StorybookAppMcp.Input["registerTools"]>>[1] = (operation, context) => {
    const notify = createRequestProgress(context)
    return run(() => invoke(controller, value => operation(value, {
      signal: context.mcpReq.signal,
      ...(notify === undefined ? {} : {onProgress: progress => notify(JSON.stringify(progress))}),
    })))
  }

  register(server, {
    ...(options.request === undefined ? {} : {request: options.request}),
    traceRequest: (tool, input, execute) => run(() => traceMcpRequest(
      tool, input, execute, options.recordRequest ?? recordMcpRequest, false,
    )),
  })

  const control = createControl({controller, lifecycle: true, resources: false})
  for (const tool of control.tools) {
    server.registerTool(tool.name, {
      ...(tool.title === undefined ? {} : {title: tool.title}),
      description: tool.description,
      inputSchema: control.schemas[tool.name]!,
      annotations: tool.annotations,
    }, (input, context) => run(async () => {
      const notify = createRequestProgress(context)
      try {
        const result = await tool.execute(input, {
          signal: context.mcpReq.signal,
          ...(notify === undefined ? {} : {onProgress: (progress: Readonly<Record<string, unknown>>) => notify(JSON.stringify(progress))}),
        }) as Record<string, unknown>
        return tool.name === "storybook_capture"
          ? captureContent(result as Parameters<typeof captureContent>[0])
          : resultContent(result)
      } catch (cause) { return response.error(cause) }
    }))
  }

  registerStorybookResources(server, controller)
  options.registerTools?.(server, execute)
  return server
}
