/**
Хранит ограниченный журнал доставленных MCP-запросов для интерфейса приложения.
Чтение полных записей и компактная сводка используют один проверенный набор данных.

@packageDocumentation
*/
import type {McpRequestRecord} from "./contract/record"
import type {StorybookAppServerRequests} from "./contract"

export type {StorybookAppServerRequests} from "./contract"

/** Хранит последние 20 общих обращений и независимо последние 20 обращений каждой локальной сессии. */
export default function createMcpRequestJournal(): StorybookAppServerRequests.Output {
  const records = new Map<string, McpRequestRecord>()
  const local = new Map<string, Map<string, McpRequestRecord>>()
  const retain = (entries: Map<string, McpRequestRecord>, record: McpRequestRecord) => {
    entries.set(record.id, record)
    while (entries.size > 20) entries.delete(entries.keys().next().value!)
  }
  return {
    write(value: unknown): void {
      if (!value || typeof value !== "object") throw new Error("Ожидается запись MCP")
      const entry = value as Record<string, unknown>
      if (typeof entry.id !== "string" || entry.id.length > 128 || typeof entry.tool !== "string" || entry.tool.length > 128
        || typeof entry.startedAt !== "number" || !Number.isFinite(entry.startedAt)
        || !["running", "success", "failed"].includes(String(entry.status))) throw new Error("Некорректная запись MCP")
      if (entry.agentId !== undefined && (typeof entry.agentId !== "string" || !entry.agentId.length || entry.agentId.length > 128)) throw new Error("Некорректный источник MCP")
      if (entry.address !== undefined && (typeof entry.address !== "string" || !entry.address.startsWith("/") || /[?#\u0000-\u0020]/u.test(entry.address) || entry.address.length > 2048)) throw new Error("Некорректный адрес агента")
      const record: McpRequestRecord = {
        id: entry.id, tool: entry.tool, startedAt: entry.startedAt,
        durationMs: typeof entry.durationMs === "number" ? entry.durationMs : null,
        status: entry.status as McpRequestRecord["status"],
        ...(typeof entry.captureId === "string" && /^capture_[A-Za-z0-9_-]+$/.test(entry.captureId) ? {captureId: entry.captureId} : {}),
        input: String(entry.input ?? ""),
        result: String(entry.result ?? ""),
        ...(typeof entry.agentId === "string" ? {agentId: entry.agentId} : {}),
        ...(typeof entry.address === "string" ? {address: entry.address} : {}),
      }
      retain(records, record)
      if (record.address !== undefined) {
        let entries = local.get(record.address)
        if (entries === undefined) local.set(record.address, entries = new Map())
        retain(entries, record)
      }
    },
    read(address?: string): readonly McpRequestRecord[] {
      return [...(address === undefined ? records.values() : local.get(address)?.values() ?? [])]
        .sort((a, b) => b.startedAt - a.startedAt).map(entry => ({...entry}))
    },
    /** Диагностика доставки без повторной передачи больших входов и ответов. */
    summary() {
      return [...records.values()].sort((a, b) => b.startedAt - a.startedAt).map(entry => ({
        id: entry.id, tool: entry.tool, startedAt: entry.startedAt, durationMs: entry.durationMs,
        status: entry.status, inputBytes: Buffer.byteLength(entry.input), resultBytes: Buffer.byteLength(entry.result),
        ...(entry.agentId === undefined ? {} : {agentId: entry.agentId}),
        ...(entry.address === undefined ? {} : {address: entry.address}),
      }))
    },
  }
}
