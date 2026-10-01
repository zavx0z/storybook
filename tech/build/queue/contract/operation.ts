/** Исход работы после завершения её собственного cleanup. */
export type BuildOutcome = "completed" | "failed" | "canceled" | "timed-out"

/** Отменяемая работа продолжает занимать slot до завершения исполнителя. */
export type BuildState = "queued" | "running" | "canceling"

/** Измерения относятся только к привязанному процессу; неизвестное значение остаётся null. */
export type BuildResources = Readonly<{
  sampledAt: string | null
  cpuPercent: number | null
  rssBytes: number | null
  descendantCount: number
  peakCpuPercent: number | null
  peakRssBytes: number | null
}>

/** Согласованный снимок одной работы; durations выражены в миллисекундах. */
export type BuildOperation<Details extends object> = Readonly<{
  operationId: string
  details: Details
  state: BuildState
  phase: string
  queuedAt: string
  startedAt: string | null
  queueDurationMs: number
  executionDurationMs: number
  resources: BuildResources
}>

/** Сохранённое завершение не удерживает процесс, AbortSignal или исполняющий callback. */
export type BuildCompletion<Details extends object> = Omit<BuildOperation<Details>, "state"> & Readonly<{
  state: "completed"
  outcome: BuildOutcome
  completedAt: string
}>
