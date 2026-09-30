/**
@property exitCode - Подтверждённый код завершения exact child handle.

@property stdout - Bounded stdout либо результат caller-specific reader.

@property stderr - Bounded stderr для диагностик владельца операции.
*/
export type OwnedChildResult = Readonly<{
  exitCode: number
  stdout: string
  stderr: string
}>
