import type {OwnedChildHandle, OwnedChildStdoutReader} from "./child"

/**
@property child - Exact subprocess handle, созданный владельцем текущей операции.

@property signal - Отмена текущего ожидания; при отмене процесс завершается до возврата ошибки.

@property timeoutMs - Полный budget работы child в миллисекундах.

@property label - Диагностическое имя операции в сообщениях ошибок.

@property [processGroup] - Detached Unix группа с leaderPid, равным PID переданного child.

@property [hardKillDelayMs=250] - Grace между TERM и KILL exact handle.

@property [outputLimit=65536] - Максимум байтов каждого стандартного captured stream.

@property [readStdout] - Пользовательский читатель stdout, который дренирует pipe до EOF.
*/
export type OwnedChildWaitInput = Readonly<{
  child: OwnedChildHandle
  signal: AbortSignal
  timeoutMs: number
  label: string
  processGroup?: Readonly<{leaderPid: number}>
  hardKillDelayMs?: number
  outputLimit?: number
  readStdout?: OwnedChildStdoutReader
}>
