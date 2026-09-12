/** Запись одного обращения MCP без заголовков авторизации. */
export interface McpRequestRecord {
  id: string
  tool: string
  startedAt: number
  durationMs: number | null
  status: "running" | "success" | "failed"
  input: string
  result: string
}

/** Создаёт ограниченный журнал одного HTTP-сервера; сохраняет последние 200 обращений. */
export function createMcpRequestJournal() {
  const records = new Map<string, McpRequestRecord>()
  return {
    write(value: unknown): void {
      if (!value || typeof value !== "object") throw new Error("Ожидается запись MCP")
      const entry = value as Record<string, unknown>
      if (typeof entry.id !== "string" || entry.id.length > 128 || typeof entry.tool !== "string" || entry.tool.length > 128
        || typeof entry.startedAt !== "number" || !Number.isFinite(entry.startedAt)
        || !["running", "success", "failed"].includes(String(entry.status))) throw new Error("Некорректная запись MCP")
      records.set(entry.id, {
        id: entry.id, tool: entry.tool, startedAt: entry.startedAt,
        durationMs: typeof entry.durationMs === "number" ? entry.durationMs : null,
        status: entry.status as McpRequestRecord["status"],
        input: String(entry.input ?? ""),
        result: String(entry.result ?? ""),
      })
      while (records.size > 200) records.delete(records.keys().next().value!)
    },
    read(): readonly McpRequestRecord[] {
      return [...records.values()].sort((a, b) => b.startedAt - a.startedAt).map(entry => ({...entry}))
    },
  }
}
