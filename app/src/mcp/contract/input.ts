import {type StorybookApp as StorybookAppContract} from "@storybook/app"
type StorybookControllerContext = Parameters<StorybookAppContract.Output["ensure"]>[1]
type StorybookControllerResult = Awaited<ReturnType<StorybookAppContract.Output["ensure"]>>
import type {CallToolResult, McpServer, ServerContext} from "@modelcontextprotocol/server"
import type {AppMcp} from "@app/mcp"
import type {recordMcpRequest} from "../src/request-log"

/**
Зависимости MCP-сервера: передача HTTP-запросов, управление и журналирование.

Контракты предметных ответов остаются на HTTP-сервере.

@property [controller] - Готовый публичный `StorybookApp.Output` для управляющих
инструментов и ресурсов. Имеет приоритет перед фабрикой.

@property [controllerFactory] - Отложенное создание управляющего контроллера,
если готовый контроллер не передан. Проксирование предметного запроса его не загружает.
Без обеих зависимостей используется контроллер самого Storybook.

@property [request] - Передача предметного запроса HTTP-серверу.
Без замены используется публичный `@app-mcp/proxy` через предметный `@app/mcp`.

@property [recordRequest] - Запись этапов и исходов запросов в журнал.
Без замены используется {@link recordMcpRequest}.

@property [registerTools] - Регистрирует инструменты приложения штатным API SDK.
execute использует тот же отложенный контроллер, журнал и упаковку ответа,
что встроенные инструменты. Сигнал и progress текущего MCP-запроса передаются
операции через context. Регистрация сама по себе не загружает контроллер.
*/
export interface CreateStorybookMcpServerInput {
  readonly controller?: StorybookAppContract.Output
  readonly controllerFactory?: () => StorybookAppContract.Output | Promise<StorybookAppContract.Output>
  readonly request?: AppMcp.Input["request"]
  readonly recordRequest?: typeof recordMcpRequest
  readonly registerTools?: (
    server: McpServer,
    execute: (
      operation: (controller: StorybookAppContract.Output, context: StorybookControllerContext) => Promise<StorybookControllerResult>,
      request: Pick<ServerContext, "mcpReq">,
    ) => Promise<CallToolResult>,
  ) => void
}
