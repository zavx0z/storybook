/** Запись потока после проверки формата владельцем задачи. */
export type BuildWorkerEvent<Progress> = Readonly<{
  kind: "ready"
  workerId: string
  pid: number
}> | Readonly<{
  kind: "phase"
  event: Progress
}>

/**
@property state - Начало подтверждается точными nonce и PID; завершение — exact child.exited
после завершившегося ожидания. Ошибка подтверждения группы остаётся отказом операции.

@property workerId - Непредсказуемый идентификатор одного запуска.

@property pid - PID непосредственно созданного дочернего процесса.

@property startedAt - Время создания handle по часам родительского процесса, ISO 8601.

@property [finishedAt] - Время подтверждённого завершения дочернего процесса, ISO 8601.

@property [exitCode] - Код завершившегося процесса.
*/
export type BuildWorkerLifecycleEvent = Readonly<{
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
