/**
Хранит недавнюю диагностику доставленных запросов. Общий и адресные журналы
ссылаются на один payload. Число адресов и общий объём тел ограничены;
подробности, не поместившиеся в cache, отмечены явно без усечения JSON.
Полная предметная история принадлежит Session archive.

@packageDocumentation
*/
import type {McpRequestRecord} from "./contract/record"
import type {StorybookAppServerRequests} from "./contract"

export type {StorybookAppServerRequests} from "./contract"

type CachedRecord = {
  value: McpRequestRecord
  inputBytes: number
  resultBytes: number
  bytes: number
  order: number
  recent: number
  references: number
}

/** Создаёт recent cache: 20 общих и 20 записей каждого из 64 LRU адресов, 32 МиБ общих payload. */
export default function createMcpRequestJournal(options: StorybookAppServerRequests.Input = {}): StorybookAppServerRequests.Output {
  const limit = (value: number | undefined, fallback: number): number => {
    if (value === undefined) return fallback
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Предел журнала должен быть положительным целым")
    return value
  }
  const maxPayloadBytes = limit(options.maxPayloadBytes, 32 * 1024 * 1024)
  const maxAddresses = limit(options.maxAddresses, 64)
  const records = new Map<string, CachedRecord>()
  const global = new Map<string, CachedRecord>()
  const local = new Map<string, Map<string, CachedRecord>>()
  let payloadBytes = 0
  let order = 0
  let recent = 0
  const release = (record: CachedRecord): void => {
    record.references -= 1
    if (record.references !== 0) return
    records.delete(record.value.id)
    payloadBytes -= record.bytes
  }
  const remove = (entries: Map<string, CachedRecord>, id: string): void => {
    const record = entries.get(id)
    if (record === undefined) return
    entries.delete(id)
    release(record)
  }
  const retain = (entries: Map<string, CachedRecord>, record: CachedRecord): void => {
    if (!entries.has(record.value.id)) {
      entries.set(record.value.id, record)
      record.references += 1
    }
    while (entries.size > 20) remove(entries, entries.keys().next().value!)
  }
  const touch = (address: string, entries: Map<string, CachedRecord>): void => {
    local.delete(address)
    local.set(address, entries)
    while (local.size > maxAddresses) {
      const [oldAddress, oldEntries] = local.entries().next().value!
      local.delete(oldAddress)
      for (const record of oldEntries.values()) release(record)
    }
  }
  const omit = (record: CachedRecord): void => {
    payloadBytes -= record.bytes
    record.bytes = 0
    record.value = {...record.value, input: "", result: "", omitted: {
      reason: "payload-budget", inputBytes: record.inputBytes, resultBytes: record.resultBytes,
    }}
  }
  const ordered = (entries: Iterable<CachedRecord>): CachedRecord[] => [...entries]
    .sort((a, b) => b.value.startedAt - a.value.startedAt || b.order - a.order)
  return {
    write(value: unknown): void {
      if (!value || typeof value !== "object") throw new Error("Ожидается запись MCP")
      const entry = value as Record<string, unknown>
      if (typeof entry.id !== "string" || entry.id.length > 128 || typeof entry.tool !== "string" || entry.tool.length > 128
        || typeof entry.startedAt !== "number" || !Number.isFinite(entry.startedAt)
        || !["running", "success", "failed"].includes(String(entry.status))) throw new Error("Некорректная запись MCP")
      if (entry.agentId !== undefined && (typeof entry.agentId !== "string" || !entry.agentId.length || entry.agentId.length > 128)) throw new Error("Некорректный источник MCP")
      if (entry.address !== undefined && (typeof entry.address !== "string" || !entry.address.startsWith("/") || /[?#\u0000-\u0020]/u.test(entry.address) || entry.address.length > 2048)) throw new Error("Некорректный адрес агента")
      if (typeof entry.captureId === "string" && entry.captureId.length > 128) throw new Error("Некорректная identity снимка")
      const record: McpRequestRecord = {
        id: entry.id, tool: entry.tool, startedAt: entry.startedAt,
        durationMs: typeof entry.durationMs === "number" ? entry.durationMs : null,
        status: entry.status as McpRequestRecord["status"],
        ...(typeof entry.captureId === "string" && /^capture_[A-Za-z0-9_-]+$/.test(entry.captureId) ? {captureId: entry.captureId} : {}),
        input: String(entry.input ?? ""), result: String(entry.result ?? ""),
        ...(typeof entry.agentId === "string" ? {agentId: entry.agentId} : {}),
        ...(typeof entry.address === "string" ? {address: entry.address} : {}),
      }
      let cached = records.get(record.id)
      const inputBytes = Buffer.byteLength(record.input)
      const resultBytes = Buffer.byteLength(record.result)
      if (cached === undefined) {
        cached = {value: record, inputBytes, resultBytes, bytes: inputBytes + resultBytes, order: ++order, recent: ++recent, references: 0}
        records.set(record.id, cached)
      } else {
        if (cached.value.address !== record.address && cached.value.address !== undefined) {
          const previous = local.get(cached.value.address)
          if (previous !== undefined) {
            const previousAddress = cached.value.address
            remove(previous, record.id)
            if (previous.size === 0) local.delete(previousAddress)
          }
        }
        if (cached.references > 0) payloadBytes -= cached.bytes
        cached.value = record
        cached.inputBytes = inputBytes
        cached.resultBytes = resultBytes
        cached.bytes = inputBytes + resultBytes
        cached.recent = ++recent
        records.set(record.id, cached)
      }
      payloadBytes += cached.bytes
      retain(global, cached)
      if (record.address !== undefined) {
        const entries = local.get(record.address) ?? new Map<string, CachedRecord>()
        retain(entries, cached)
        touch(record.address, entries)
      }
      // Сначала освобождаем более старые payload; ни одно тело не усекается частично.
      if (cached.bytes > maxPayloadBytes) omit(cached)
      while (payloadBytes > maxPayloadBytes) {
        const oldest = [...records.values()].filter(value => value.bytes > 0).sort((a, b) => a.recent - b.recent)[0]
        if (oldest === undefined) break
        omit(oldest)
      }
    },
    read(address?: string): readonly McpRequestRecord[] {
      const entries = address === undefined ? global : local.get(address)
      if (address !== undefined && entries !== undefined) touch(address, entries)
      return ordered(entries?.values() ?? []).map(entry => ({...entry.value,
        ...(entry.value.omitted === undefined ? {} : {omitted: {...entry.value.omitted}}),
      }))
    },
    summary() {
      return ordered(global.values()).map(entry => ({
        id: entry.value.id, tool: entry.value.tool, startedAt: entry.value.startedAt, durationMs: entry.value.durationMs,
        status: entry.value.status, inputBytes: entry.inputBytes, resultBytes: entry.resultBytes,
        ...(entry.value.agentId === undefined ? {} : {agentId: entry.value.agentId}),
        ...(entry.value.address === undefined ? {} : {address: entry.value.address}),
        ...(entry.value.omitted === undefined ? {} : {omitted: {...entry.value.omitted}}),
      }))
    },
    residency() {
      return {addresses: local.size, records: records.size, payloadBytes, maxPayloadBytes, maxAddresses}
    },
  }
}
