import type {ProcessBinding} from "@process/measure"

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

/** Данные принадлежат вызывающему владельцу; очередь не интерпретирует их содержимое. */
export type BuildRequest<Details extends object> = Readonly<{
  operationId?: string
  details: Details
}>

/** Управление наблюдаемым ходом допущенной работы без публикации private PID. */
export type BuildContext<Details extends object> = Readonly<{
  operationId: string
  signal: AbortSignal
  queuedAt: string
  startedAt: string
  setPhase(phase: string): void
  setDetails(details: Details): void
  bindWorker(binding: ProcessBinding): () => void
  clearWorker(): void
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

/** Событие содержит только переход; измерение процессов не запускается ради сообщения. */
export type BuildTransition<Details extends object> = Readonly<{
  at: string
  operationId: string
  details: Details
  phase: string
}> & (Readonly<{state: BuildState; outcome?: never}> | Readonly<{state: "completed"; outcome: BuildOutcome}>)

/** Полученный slot освобождается только после завершения собственных ресурсов исполнителя. */
export type BuildAdmission<Details extends object> = Readonly<{
  context: BuildContext<Details>
  finish(outcome: BuildOutcome): void
}>
