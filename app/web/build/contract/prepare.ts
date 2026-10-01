/** Предоставленные сборка и извлечение версий одной подготовленной поставки. */
export type PrepareInput<Prepared, Version extends object> = Readonly<{
  prepare(signal: AbortSignal): Promise<Prepared>
  versions(prepared: Prepared): readonly Version[]
}>

/** Кандидат и неизменяемый снимок его версий после проверки отмены. */
export type PreparedResult<Prepared, Version extends object> = Readonly<{
  candidate: Prepared
  versions: readonly Version[]
}>
