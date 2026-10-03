import type {CallToolResult, McpServer, ServerContext} from "@modelcontextprotocol/server"
import type {AppMcpProxy} from "@app-mcp/proxy"
import type {McpRest} from "@mcp/rest"
import type {Controller, ControllerContext, ControllerResult} from "./types"

/** Контракт предметного lazy-входа Storybook MCP. */
export declare namespace AppMcp {
  /**
  Необязательные зависимости предметной регистрации и полной MCP-сессии.

  @property [request] - Передаёт непрозрачный path действующему серверу;
  по умолчанию используется публичный `@app-mcp/proxy`, читающий state при вызове.

  @property [traceRequest] - Оборачивает только доставку предметного запроса
  в журнал вызывающего приложения. Успешный JSON status не меняет исход
  транспорта; исключение callback обрабатывается как ошибка инструмента.
  @property [controller] - Готовый контроллер для управляющих tools/resources.
  @property [controllerFactory] - Отложенное создание того же контроллера.
  @property [recordRequest] - Журнал доставки и исхода MCP-запроса.
  @property [registerTools] - Дополнительные регистрации на том же SDK server.
  */
  type Input = Readonly<{
    request?: (input: AppMcpProxy.Input, signal: AbortSignal) => Promise<AppMcpProxy.Output>
    traceRequest?: (
      tool: "storybook",
      input: AppMcpProxy.Input,
      execute: () => Promise<AppMcpProxy.Output>,
    ) => Promise<AppMcpProxy.Output>
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

  @property read - Читает выбранный адрес через публичный `@mcp/rest`, используя
  готовые entries того же каталога; не выполняет файлы сценариев.
  @property createServer - Регистрирует управляющие инструменты и ресурсы на
  одном SDK server; получает контроллер только при первом управляющем вызове.
  */
  type Output = Readonly<{
    register(server: McpServer, options?: Input): void
    read(request: McpRest.Input[0], options: McpRest.Input[1]): Promise<McpRest.Output>
    createServer(options?: Input): McpServer
  }>
}
