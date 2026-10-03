/**
Ожидает переданный дочерний процесс и подтверждает его завершение при отмене
или исчерпании времени. Владение процессом остаётся у вызывающего кода:
ожидание сигналит только точный handle либо явно переданную detached группу.
Вывод дренируется до конца с ограничением объёма сохранённых данных.

@packageDocumentation
*/
import readBoundedChildStream from "./src/read-bounded"
import {signalOwnedProcess, confirmOwnedProcessGroupExit, ownedProcessGroupExists, isMissingProcessError, isProcessPermissionError} from "./src/lifecycle"
import type {ProcessWait} from "./contract"

export type {ProcessWait} from "./contract"

/**
Ожидает переданный дочерний процесс и подтверждает его завершение при успехе, отмене и таймауте.

Сигналы отправляются только переданному handle либо явно заданной detached
группе. Процессы не ищутся по имени команды. Завершение группы подтверждается
после выхода дочернего процесса; постоянная ошибка проверки не считается успешной очисткой.

@throws Исходная причина отмены либо `TimeoutError` после подтверждённого завершения.

@throws `RangeError` при неположительном или неограниченном таймауте, отрицательной
или неограниченной задержке принудительного завершения.

@throws Ошибка неверной привязки detached группы, чтения вывода или подтверждения завершения.
*/
export default async function waitForOwnedChild(
  input: ProcessWait.Input,
): Promise<ProcessWait.Output> {
  const hardKillDelayMs = input.hardKillDelayMs ?? 250
  const outputLimit = input.outputLimit ?? 64 * 1024
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
    throw new RangeError(`Owned child timeout must be positive: ${input.timeoutMs}`)
  }
  if (!Number.isFinite(hardKillDelayMs) || hardKillDelayMs < 0) {
    throw new RangeError(`Owned child hard-kill delay cannot be negative: ${hardKillDelayMs}`)
  }
  if (input.processGroup !== undefined && (
    process.platform === "win32" || input.processGroup.leaderPid !== input.child.pid || input.child.pid <= 0
  )) {
    throw new Error("Owned process group must be an exact detached Unix child leader")
  }
  let timedOut = false
  let abortReason: unknown = null
  let terminationRequested = false
  let readerError: unknown = null
  let hardKill: ReturnType<typeof setTimeout> | null = null
  /** Запрашивает завершение один раз и сохраняет первую причину остановки. */
  const terminate = (reason: unknown, timeout: boolean): void => {
    if (terminationRequested) return
    terminationRequested = true
    abortReason = reason
    timedOut = timeout
    try {
      signalOwnedProcess(input, "SIGTERM")
      hardKill = setTimeout(() => {
        try {
          signalOwnedProcess(input, "SIGKILL")
        } catch {
          // Переданный процесс или его группа уже завершились.
        }
      }, hardKillDelayMs)
    } catch {
      // Переданный процесс или его группа уже завершились.
    }
  }
  /** Переносит причину отмены вызывающего кода в завершение точного процесса. */
  const onAbort = (): void => terminate(input.signal.reason, false)
  input.signal.addEventListener("abort", onAbort, {once: true})
  if (input.signal.aborted) onAbort()
  const timer = input.timeoutMs === undefined ? undefined : setTimeout(() => terminate(
    new Error(`${input.label} timed out after ${input.timeoutMs}ms`),
    true,
  ), input.timeoutMs)
  try {
    /** Ошибка reader останавливает процесс; завершение pipe ожидается вместе с exit. */
    const protectReader = async (reader: Promise<string>): Promise<string> => {
      try {
        return await reader
      } catch (error) {
        readerError ??= error
        terminate(error, false)
        return ""
      }
    }
    const [exitCode, stdout, stderr] = await Promise.all([
      input.child.exited,
      protectReader(input.readStdout === undefined
        ? readBoundedChildStream(input.child.stdout, outputLimit)
        : input.readStdout(input.child.stdout)),
      protectReader(readBoundedChildStream(input.child.stderr, outputLimit)),
    ])
    if (terminationRequested && input.processGroup !== undefined) {
      await confirmOwnedProcessGroupExit(input.processGroup.leaderPid, hardKillDelayMs)
    }
    if (!terminationRequested && input.processGroup !== undefined &&
      await ownedProcessGroupExists(input.processGroup.leaderPid)) {
      try {
        process.kill(-input.processGroup.leaderPid, "SIGKILL")
      } catch (error) {
        if (!isMissingProcessError(error) && !isProcessPermissionError(error)) throw error
      }
      await confirmOwnedProcessGroupExit(input.processGroup.leaderPid, 0)
      throw new Error(`${input.label} worker exited before its owned descendants`)
    }
    if (readerError !== null) {
      throw new Error(`${input.label} output reader failed`, {cause: readerError})
    }
    if (input.signal.aborted) {
      throw abortReason instanceof Error ? abortReason : input.signal.reason
    }
    if (timedOut) {
      const error = new Error(
        abortReason instanceof Error ? abortReason.message : `${input.label} timed out`,
      )
      error.name = "TimeoutError"
      throw error
    }
    return Object.freeze({exitCode, stdout, stderr})
  } finally {
    clearTimeout(timer)
    if (hardKill !== null) clearTimeout(hardKill)
    input.signal.removeEventListener("abort", onAbort)
  }
}
