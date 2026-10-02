/** Находит владельца открытой страницы и возвращает его точный MCP-запрос и ответ. */
export interface McpAddressSource {
  readAddress(): string
  request(address: string, signal: AbortSignal): Promise<{input: {path?: string} | null, result: unknown, failed: boolean}>
}
