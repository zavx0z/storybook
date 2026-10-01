import type {OwnedChildHandle, OwnedChildStdoutReader} from "./child"

/** Ограниченное ожидание переданного дочернего процесса. */
export declare namespace ProcessWait {
  /** Exact handle процесса и политика ожидания владельца. */
  type Input = Readonly<{
    child: OwnedChildHandle
    signal: AbortSignal
    timeoutMs: number
    label: string
    processGroup?: Readonly<{leaderPid: number}>
    hardKillDelayMs?: number
    outputLimit?: number
    readStdout?: OwnedChildStdoutReader
  }>

  /** Подтверждённый код завершения и ограниченный вывод. */
  type Output = Readonly<{
    exitCode: number
    stdout: string
    stderr: string
  }>
}
