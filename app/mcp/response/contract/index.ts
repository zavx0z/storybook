import type {CallToolResult} from "@modelcontextprotocol/server"

/** Контракт публичной очистки непрозрачного предметного MCP-ответа. */
export declare namespace Zavx0zStorybookAppMcpResponse {
  /** Успешный JSON-объект предметного HTTP-читателя. */
  type Input = Readonly<Record<string, unknown>>

  /**
  Кодек транспорта без интерпретации полей предметного ответа.

  @property sanitizeString - Заменяет локальный origin, внутренние target IDs,
  capability tokens и пути владельцев перед публичной выдачей текста.

  @property sanitizeValue - Рекурсивно очищает JSON-значение, удаляя
  служебные ключи и применяя `sanitizeString` к строкам.

  @property sanitizeText - Очищает ресурс; для JSON сначала разбирает
  структуру, при ошибке разбора обрабатывает ограниченный текст.

  @property error - Формирует общий failed/timeout envelope с code/message
  и `isError: true`; техническое сообщение очищается и ограничивается 4096 символами.
  */
  type Output = ((result: Input) => CallToolResult) & Readonly<{
    sanitizeString(value: string): string
    sanitizeValue(value: unknown): unknown
    sanitizeText(value: string, mimeType: string): string
    error(error: unknown): CallToolResult
  }>
}
