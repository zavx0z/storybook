import type {OwnedChildHandle, OwnedChildStdoutReader} from "./child"

/** Ожидание результата или отмены переданного дочернего процесса. */
export declare namespace Zavx0zStorybookTechProcessWait {
  /** Exact handle процесса и политика ожидания владельца. */
  type Input = Readonly<{
    child: OwnedChildHandle
    signal: AbortSignal
    /** Только явный срок вызывающего кода; без значения общего таймера нет. */
    timeoutMs?: number | undefined
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
