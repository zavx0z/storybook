import type {CallToolResult, McpServer, ServerContext} from "@modelcontextprotocol/server"
import type {StorybookAppMcpProxy} from "@storybook-app-mcp/proxy"
import type {StorybookAppMcpRest} from "@storybook-app-mcp/rest"
import type {Controller, ControllerContext, ControllerResult} from "./types"

/** Контракт предметного lazy-входа Storybook MCP. */
export declare namespace StorybookAppMcp {
  /**
  Необязательные зависимости предметной регистрации и полной MCP-сессии.

  @property [request] - Передаёт непрозрачный path действующему серверу;
  по умолчанию используется публичный `@storybook-app-mcp/proxy`, читающий state при вызове.

  @property [traceRequest] - Оборачивает только доставку предметного запроса
  в журнал вызывающего приложения. Успешный JSON status не меняет исход
  транспорта; исключение callback обрабатывается как ошибка инструмента.
  @property [controller] - Готовый контроллер для управляющих tools/resources.
  @property [controllerFactory] - Отложенное создание того же контроллера.
  @property [recordRequest] - Журнал доставки и исхода MCP-запроса.
  @property [registerTools] - Дополнительные регистрации на том же SDK server.
  */
  type Input = Readonly<{
    request?: (input: StorybookAppMcpProxy.Input, signal: AbortSignal) => Promise<StorybookAppMcpProxy.Output>
    traceRequest?: (
      tool: "storybook",
      input: StorybookAppMcpProxy.Input,
      execute: () => Promise<StorybookAppMcpProxy.Output>,
    ) => Promise<StorybookAppMcpProxy.Output>
    controller?: Controller
    controllerFactory?: () => Controller | Promise<Controller>
    recordRequest?: (entry: Record<string, unknown>) => Promise<void>
    registerTools?: (
      server: McpServer,
      execute: (
        operation: (controller: Controller, context: ControllerContext) => Promise<ControllerResult>,
        request: Pick<ServerContext, "mcpReq">,
      ) => Promise<CallToolResult>,
    ) => void
  }>

  /**
  Native MCP-сервер, предметная регистрация и чтение того же REST-контракта.

  @property register - Регистрирует один lazy-инструмент `storybook` в
  переданном сервере MCP SDK; не создаёт контроллер и не запускает HTTP-сервер.

  @property read - Читает выбранный адрес через публичный `@storybook-app-mcp/rest`, используя
  готовые entries того же каталога; не выполняет файлы сценариев.
  @property createServer - Регистрирует управляющие инструменты и ресурсы на
  одном SDK server; получает контроллер только при первом управляющем вызове.
  */
  type Output = Readonly<{
    register(server: McpServer, options?: Input): void
    read(request: StorybookAppMcpRest.Input[0], options: StorybookAppMcpRest.Input[1]): Promise<StorybookAppMcpRest.Output>
    createServer(options?: Input): McpServer
  }>
}
