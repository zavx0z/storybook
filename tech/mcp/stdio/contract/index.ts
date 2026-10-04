import type {McpServer} from "@modelcontextprotocol/server"

/** Контракт stdio-времени жизни одного MCP-сервера. */
export declare namespace Zavx0zStorybookTechMcpStdio {
  /**
  Подключение подготовленного сервера к stdin/stdout текущего процесса.

  @property createServer - Создаёт сервер стандартного MCP SDK для одного stdio-соединения.
  Вызывающий код регистрирует инструменты до возврата; ошибка создания передаётся SDK.

  @property diagnosticLabel - Краткое имя источника для строк stderr. Диагностика ограничивается
  4096 символами в строке, переносы заменяются пробелами; stdout остаётся за MCP-протоколом.
  */
  type Input = Readonly<{
    createServer(): McpServer
    diagnosticLabel: string
  }>

  /**
  Время жизни stdio-соединения, принадлежащее вызывающему процессу.

  @property close - Один раз снимает обработчики SIGINT/SIGTERM и закрывает transport SDK.
  Повторный вызов возвращает то же ожидание. При сигналах helper закрывает transport,
  затем завершает процесс с кодом 130 или 143 соответственно. Ошибка закрытия
  отклоняет Promise вызывающего кода; обработчик сигнала всё равно завершает процесс.
  */
  type Output = Readonly<{
    close(): Promise<void>
  }>
}
