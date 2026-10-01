/**
Хранит ограниченный журнал доставленных MCP-запросов для интерфейса приложения.
Чтение полных записей и компактная сводка используют один проверенный набор данных.

@packageDocumentation
*/
import type {McpRequestRecord} from "./contract/record"
import type {McpRestRequests} from "./contract"

export type {McpRestRequests} from "./contract"

/** Создаёт ограниченный журнал одного HTTP-сервера; сохраняет последние 20 обращений. */
export default function createMcpRequestJournal(): McpRestRequests.Output {
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
        ...(typeof entry.captureId === "string" && /^capture_[A-Za-z0-9_-]+$/.test(entry.captureId) ? {captureId: entry.captureId} : {}),
        input: String(entry.input ?? ""),
        result: String(entry.result ?? ""),
      })
      while (records.size > 20) records.delete(records.keys().next().value!)
    },
    read(): readonly McpRequestRecord[] {
      return [...records.values()].sort((a, b) => b.startedAt - a.startedAt).map(entry => ({...entry}))
    },
    /** Диагностика доставки без повторной передачи больших входов и ответов. */
    summary() {
      return [...records.values()].sort((a, b) => b.startedAt - a.startedAt).map(entry => ({
        id: entry.id, tool: entry.tool, startedAt: entry.startedAt, durationMs: entry.durationMs,
        status: entry.status, inputBytes: Buffer.byteLength(entry.input), resultBytes: Buffer.byteLength(entry.result),
      }))
    },
  }
}
