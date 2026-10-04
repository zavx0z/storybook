/** Одна запись доставки MCP без заголовка авторизации. */
export type McpRequestRecord = Readonly<{
  id: string
  tool: string
  startedAt: number
  durationMs: number | null
  status: "running" | "success" | "failed"
  input: string
  result: string
  captureId?: string
  /** Идентичность подключения вызывающего агента; не идентичность цели команды. */
  agentId?: string
  /** Канонический адрес локальной сессии агента; у внешнего общего агента отсутствует. */
  address?: string
}>
