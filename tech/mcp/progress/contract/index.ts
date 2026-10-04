import type {ServerContext} from "@modelcontextprotocol/server"

/** Контракт уведомлений о прогрессе одного MCP-запроса. */
export declare namespace Zavx0zStorybookTechMcpProgress {
  /**
  Контекст SDK текущего запроса, из которого читаются progressToken и отмена.

  @property mcpReq - `_meta.progressToken` разрешает отправку уведомлений;
  `signal` прекращает их после отмены, а `notify` отправляет стандартное
  `notifications/progress`. Контекст не сохраняется между запросами.
  */
  type Input = Readonly<{
    mcpReq: Pick<ServerContext["mcpReq"], "_meta" | "signal" | "notify">
  }>

  /**
  Callback для сообщений о фактически наблюдаемых стадиях либо `undefined`,
  если клиент не передал progressToken. Счётчик начинается с 1 для каждого
  запроса; после отмены callback ничего не отправляет. Ошибка SDK `notify`
  отклоняет Promise вызывающего кода.
  */
  type Output = ((message: string) => Promise<void>) | undefined
}
