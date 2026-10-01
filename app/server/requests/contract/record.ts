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
}>
