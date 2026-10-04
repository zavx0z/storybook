import type {McpServer} from "@modelcontextprotocol/server"

/** Один MCP transport с актуальными схемами и handlers отдельного исполняемого модуля. */
export declare namespace StorybookTechMcpLazy {
  /**
  Доверенная конфигурация каждого изолированного выполнения.

  @property serverModule - Абсолютный путь к factory-модулю MCP-сервера; не принимается из tool arguments.
  @property cwd - Абсолютный рабочий каталог worker.
  @property temporaryRoot - Абсолютный корень временных областей worker, исключённый из наблюдения.
  @property [name] - Имя постоянного transport server; по умолчанию lazy-mcp.
  @property [version] - Версия постоянного transport server; по умолчанию 1.0.0.
  @property [timeoutMs] - Необязательный явно заданный срок клиента; по умолчанию запрос ждёт результат или отмену. Progress не ограничен общей длительностью.
  @property [watchRoot] - Абсолютный корень исходников для уведомлений об изменении списков.
  При отсутствии клиент получает текущие списки при явном чтении. Ошибка наблюдения не прерывает запросы.
  */
  export type Input = Readonly<{
    serverModule: string
    cwd: string
    temporaryRoot: string
    name?: string
    version?: string
    timeoutMs?: number
    watchRoot?: string
  }>

  /** Стандартный SDK server; close отменяет его запросы и освобождает watcher. */
  export type Output = McpServer
}
