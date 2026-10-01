import type {McpServer} from "@modelcontextprotocol/server"
import type {AppMcpProxy} from "@app-mcp/proxy"
import type {McpRest} from "@mcp/rest"

/** Контракт предметного lazy-входа Storybook MCP. */
export declare namespace AppMcp {
  /**
  Необязательные зависимости одного зарегистрированного инструмента.

  @property [request] - Передаёт непрозрачный path действующему серверу;
  по умолчанию используется публичный `@app-mcp/proxy`, читающий state при вызове.

  @property [traceRequest] - Оборачивает только доставку предметного запроса
  в журнал вызывающего приложения. Успешный JSON status не меняет исход
  транспорта; исключение callback обрабатывается как ошибка инструмента.
  */
  type Input = Readonly<{
    request?: (input: AppMcpProxy.Input, signal: AbortSignal) => Promise<AppMcpProxy.Output>
    traceRequest?: (
      tool: "storybook",
      input: AppMcpProxy.Input,
      execute: () => Promise<AppMcpProxy.Output>,
    ) => Promise<AppMcpProxy.Output>
  }>

  /**
  Предметная регистрация и чтение того же REST-контракта.

  @property register - Регистрирует один lazy-инструмент `storybook` в
  переданном сервере MCP SDK; не создаёт контроллер и не запускает HTTP-сервер.

  @property read - Читает выбранный адрес через публичный `@mcp/rest`, используя
  готовые entries того же каталога; не выполняет файлы сценариев.
  */
  type Output = Readonly<{
    register(server: McpServer, options?: Input): void
    read(request: McpRest.Input[0], options: McpRest.Input[1]): Promise<McpRest.Output>
  }>
}
