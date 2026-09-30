/**
Строка одного процесса из низкочастотного системного снимка.

@property cpuPercent - Значение `%CPU`, предоставленное системным `ps`.
Sampler не приписывает ему более точную временную семантику; `null` означает,
что системный источник не предоставил значение.

@property rssBytes - Resident set в байтах, а не виртуальный размер процесса.
`null` означает, что системный источник не предоставил значение.

@property startedAt - Системная метка старта защищает привязку от повторного
использования PID, когда владелец операции смог передать такую метку.
*/
export type ProcessResourceRow = Readonly<{
  pid: number
  parentPid: number
  cpuPercent: number | null
  rssBytes: number | null
  startedAt: string | null
}>
