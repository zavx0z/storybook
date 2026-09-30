/**
@property workerId - Идентификатор завершённого запуска.

@property ready - Поток подтвердил exact nonce и PID созданного процесса.

@property exitCode - Подтверждённый код завершения; ненулевой код интерпретирует владелец задачи.

@property stderr - Не более 65536 байтов диагностического потока.

@property result - JSON из result.json; undefined при отсутствии файла, null сохраняется.
*/
export type BuildWorkerOutput = Readonly<{
  workerId: string
  ready: boolean
  exitCode: number
  stderr: string
  result: unknown
}>
