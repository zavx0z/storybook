import type {ProcessMeasure} from "@process/measure"
import type {BuildOutcome, BuildState} from "../contract/operation"

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
  bindWorker(binding: ProcessMeasure.Input["binding"]): () => void
  clearWorker(): void
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
