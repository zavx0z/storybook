/** Версия ограниченного однонаправленного потока событий package build worker. */
export const STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL = "storybook-build-worker-event/1" as const

/** Фазы compiler/build, которые scheduler может показывать без знания внутренних файлов. */
export type StorybookBuildPhase =
  | "cache"
  | "fingerprint"
  | "resources"
  | "exports"
  | "bundle"
  | "kernel"
  | "host"
  | "protocol-build"
  | "protocol-run"
  | "publish"

/**
@property phase - Текущая ограниченная фаза package build.

@property state - Граница входа в фазу либо её успешного завершения.

@property at - Время события ISO 8601 по часам процесса worker.
*/
export type StorybookBuildPhaseEvent = Readonly<{
  phase: StorybookBuildPhase
  state: "started" | "completed"
  at: string
  cache?: Readonly<{status: "hit" | "miss", layer: "shared"}>
}>

/** Получает фазовые события одной package build operation в порядке worker stream. */
export type StorybookBuildPhaseListener = (event: StorybookBuildPhaseEvent) => void

/**
@property state - `started` приходит только после handshake exact spawned worker.

@property workerId - Непредсказуемый launch nonce, унаследованный protocol child.

@property pid - Private PID для привязки редкого resource sample к exact operation.

@property startedAt - Время создания exact process handle в родительском процессе.

@property [finishedAt] - Время подтверждённого завершения exact worker.

@property [exitCode] - Код завершившегося worker.
*/
export type StorybookBuildWorkerLifecycleEvent = Readonly<{
  state: "started"
  workerId: string
  pid: number
  startedAt: string
}> | Readonly<{
  state: "exited"
  workerId: string
  pid: number
  startedAt: string
  finishedAt: string
  exitCode: number
}>

/** Получает private lifecycle exact worker и не публикует PID в Storybook status. */
export type StorybookBuildWorkerLifecycleListener = (
  event: StorybookBuildWorkerLifecycleEvent,
) => void

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
  const cache = value.event.cache === undefined ? undefined : parseSharedCacheOutcome(value.event.cache)
  if (cache === null) return null
  return Object.freeze({
    protocol: STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL,
    kind: "phase",
    event: Object.freeze({
      phase: value.event.phase,
      state: value.event.state,
      at: value.event.at,
      ...(cache === undefined ? {} : {cache}),
    }),
  })
}

/** Ограничивает phase vocabulary согласованным scheduler contract. */
function isStorybookBuildPhase(value: unknown): value is StorybookBuildPhase {
  return [
    "cache",
    "fingerprint",
    "resources",
    "exports",
    "bundle",
    "kernel",
    "host",
    "protocol-build",
    "protocol-run",
    "publish",
  ].includes(String(value))
}

function parseSharedCacheOutcome(value: unknown): Readonly<{status: "hit" | "miss", layer: "shared"}> | null {
  if (value === null || typeof value !== "object") return null
  const cache = value as Record<string, unknown>
  if ((cache.status !== "hit" && cache.status !== "miss") || cache.layer !== "shared") {
    return null
  }
  return Object.freeze({status: cache.status, layer: "shared"})
}

/** Отклоняет произвольные строки вместо transport timestamp. */
function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

/** Отличает JSON object от массивов и примитивов. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
