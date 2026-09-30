import type {OwnedChildWaitInput} from "../contract/input"

/** Отправляет сигнал переданному handle либо detached группе с тем же корневым PID. */
export function signalOwnedProcess(
  input: OwnedChildWaitInput,
  signal: "SIGTERM" | "SIGKILL",
): void {
  if (input.processGroup === undefined) {
    input.child.kill(signal === "SIGKILL" ? 9 : undefined)
    return
  }
  process.kill(-input.processGroup.leaderPid, signal)
}

/**
Подтверждает исчезновение detached группы в ограниченное время после выхода корня.

После TERM ожидание длится не дольше заданной задержки, затем повторяется SIGKILL
точному PGID. Ядру даётся короткое окно убрать оставшихся потомков.
PID не разрешается заново по имени команды.
*/
export async function confirmOwnedProcessGroupExit(leaderPid: number, graceMs: number): Promise<void> {
  const termDeadline = Date.now() + graceMs
  const killDeadline = termDeadline + 1_000
  while (await ownedProcessGroupExists(leaderPid, killDeadline) && Date.now() < termDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  if (!(await ownedProcessGroupExists(leaderPid, killDeadline))) return
  try {
    process.kill(-leaderPid, "SIGKILL")
  } catch (error) {
    if (!isMissingProcessError(error) && !isProcessPermissionError(error)) throw error
  }
  while (await ownedProcessGroupExists(leaderPid, killDeadline) && Date.now() < killDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  if (await ownedProcessGroupExists(leaderPid, killDeadline)) {
    throw new Error(`Owned process group ${leaderPid} did not exit after SIGKILL`)
  }
}

/**
Проверяет точный PGID без перечисления процессов. Darwin может вернуть EPERM,
когда в ещё существующей группе остались только zombie: killpg1 пропускает их.
Повторяется только signal 0 до подтверждённого ESRCH; постоянный EPERM остаётся ошибкой.

См. [реализацию killpg1](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c).
*/
export async function ownedProcessGroupExists(leaderPid: number, deadline = Date.now() + 1_000): Promise<boolean> {
  while (true) {
    try {
      process.kill(-leaderPid, 0)
      return true
    } catch (error) {
      if (isMissingProcessError(error)) return false
      if (!isProcessPermissionError(error) || Date.now() >= deadline) throw error
      await new Promise<void>(resolve => setTimeout(resolve, 10))
    }
  }
}

/** EPERM требует подтверждения состояния группы, а не признания её завершённой. */
export function isProcessPermissionError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EPERM"
}

/** ESRCH означает, что exact PID/PGID больше не существует. */
export function isMissingProcessError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH"
}
