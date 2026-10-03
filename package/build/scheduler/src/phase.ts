import type {StorybookBuildWorkerPhase} from "../contract/types"

/** Граница одной фазы package/shared build с временем worker. */
type StorybookBuildPhaseEvent = Readonly<{
  phase: StorybookBuildWorkerPhase
  state: "started" | "completed"
  at: string
}>


/** Версия ограниченного однонаправленного потока событий package build worker. */
export const STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL = "storybook-build-worker-event/1" as const

/** Handshake доказывает, что spawned process получил launch nonce до phase events. */
export type StorybookBuildWorkerReadyEvent = Readonly<{
  protocol: typeof STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL
  kind: "ready"
  workerId: string
  pid: number
}>

/** Transport envelope отделяет handshake от публичного phase event. */
export type StorybookBuildWorkerPhaseTransportEvent = Readonly<{
  protocol: typeof STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL
  kind: "phase"
  event: StorybookBuildPhaseEvent
}>

/** Единственная JSONL запись, разрешённая в stdout package build worker. */
export type StorybookBuildWorkerTransportEvent =
  | StorybookBuildWorkerReadyEvent
  | StorybookBuildWorkerPhaseTransportEvent

/** Проверяет bounded JSONL record до передачи scheduler callback. */
export function parseStorybookBuildWorkerTransportEvent(
  value: unknown,
): StorybookBuildWorkerTransportEvent | null {
  if (!isObject(value) || value.protocol !== STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL ||
    (value.kind !== "ready" && value.kind !== "phase")) return null
  if (value.kind === "ready") {
    return typeof value.workerId === "string" && value.workerId.length >= 16 &&
      Number.isSafeInteger(value.pid) && Number(value.pid) > 0
      ? Object.freeze({
        protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL,
        kind: "ready",
        workerId: value.workerId,
        pid: Number(value.pid),
      })
      : null
  }
  if (!isObject(value.event) || !isStorybookBuildPhase(value.event.phase) ||
    (value.event.state !== "started" && value.event.state !== "completed") ||
    typeof value.event.at !== "string" || !validTimestamp(value.event.at)) return null
  return Object.freeze({
    protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL,
    kind: "phase",
    event: Object.freeze({
      phase: value.event.phase,
      state: value.event.state,
      at: value.event.at,
    }),
  })
}

/** Ограничивает phase vocabulary согласованным scheduler contract. */
function isStorybookBuildPhase(value: unknown): value is StorybookBuildWorkerPhase {
  return typeof value === "string" && [
    "verification",
    "resources",
    "exports",
    "bundle",
    "kernel",
    "host",
    "publish",
  ].includes(value)
}

/** Отклоняет произвольные строки вместо transport timestamp. */
function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

/** Отличает JSON object от массивов и примитивов. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
