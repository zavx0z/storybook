import type {Progress} from "@modelcontextprotocol/client"
import type {BuildWorker} from "@build/worker"

// Предел тишины native SDK сбрасывается progress; общего срока операции нет.
export const MCP_IDLE_TIMEOUT_MS = 900_000
export const MCP_HARD_KILL_DELAY_MS = 10_000
export const MCP_CANCELLATION_DRAIN_MS = 8_000
export const MCP_RESULT_MAX_BYTES = 192 * 1024 * 1024

export type LazyMethod = "tools/list" | "tools/call" | "resources/list" | "resources/templates/list" | "resources/read"
export type LazyProgress = Pick<Progress, "progress" | "total" | "message">

export type LazyJob = Readonly<{
  serverModule: string
  method: LazyMethod
  params: Readonly<Record<string, unknown>>
  progress: boolean
}>

export type LazyOutcome = Readonly<{
  ok: true
  result: Record<string, unknown>
}> | Readonly<{
  ok: false
  error: Readonly<{code: number, message: string, data?: unknown}>
}>

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function isLazyMethod(value: unknown): value is LazyMethod {
  return ["tools/list", "tools/call", "resources/list", "resources/templates/list", "resources/read"].includes(String(value))
}

/** Проверяет только собственный envelope; native MCP result внутри остаётся без преобразования. */
export function isLazyOutcome(value: unknown): value is LazyOutcome {
  if (!isRecord(value)) return false
  if (value.ok === true) return isRecord(value.result)
  if (value.ok !== false || !isRecord(value.error)) return false
  return Number.isSafeInteger(value.error.code) && typeof value.error.message === "string"
}

/** Внутренний token SDK не выходит в transport родителя; остальные request metadata сохраняются. */
export function requestParams(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (!isRecord(value._meta)) return {...value}
  const {progressToken: _innerToken, ...metadata} = value._meta
  return {...value, _meta: metadata}
}

/** Ready подтверждает runner; phase переносит только проверенный native progress. */
export function parseLazyEvent(value: unknown): ReturnType<BuildWorker.Input<LazyJob, LazyProgress>["parseEvent"]> {
  if (!isRecord(value)) return null
  if (value.kind === "ready" && typeof value.workerId === "string" && Number.isSafeInteger(value.pid)) {
    return {kind: "ready", workerId: value.workerId, pid: Number(value.pid)}
  }
  if (value.kind !== "phase" || !isRecord(value.event)) return null
  const event = value.event
  if (typeof event.progress !== "number" || !Number.isFinite(event.progress) ||
    event.total !== undefined && (typeof event.total !== "number" || !Number.isFinite(event.total)) ||
    event.message !== undefined && typeof event.message !== "string" || "progressToken" in event) return null
  return {kind: "phase", event: event as LazyProgress}
}
