/**
Результат исполнения сценария настоящим Bun Test через инспектор.

@property path - Абсолютный путь исполненного файла.

@property exitCode - Код завершения дочернего Bun Test.

@property stdout - Стандартный вывод дочернего процесса.

@property stderr - Диагностический вывод дочернего процесса, включая сообщения инспектора.

@property events - Наблюдённые события с данными, полученными от инспектора.

@property pauses - Области видимости выбранного файла в точках остановки.
*/
export interface ReadScenarioOutput {
  path: string
  exitCode: number
  stdout: string
  stderr: string
  events: Array<{method: string, params: Record<string, unknown>}>
  pauses: Array<{reason: unknown, frames: unknown[]}>
}
