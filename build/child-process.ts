/**
@property exitCode - Подтверждённый код завершения exact child handle.

@property stdout - Bounded stdout либо результат caller-specific reader.

@property stderr - Bounded stderr для диагностик владельца операции.
*/
export type StorybookOwnedChildResult = Readonly<{
  exitCode: number
  stdout: string
  stderr: string
}>

/** Caller-specific event stream reader обязан полностью дренировать переданный pipe. */
export type StorybookOwnedChildStdoutReader = (stream: unknown) => Promise<string>

/** Минимальный exact handle, который owner получает непосредственно от `Bun.spawn`. */
export type StorybookOwnedChildHandle = Readonly<{
  pid: number
  exited: Promise<number>
  stdout: unknown
  stderr: unknown
  kill(signal?: number): unknown
}>

/**
@property child - Exact subprocess handle, созданный владельцем текущей операции.

@property signal - Abort operation после admission; очередь не создаёт process.

@property timeoutMs - Полный budget работы child в миллисекундах.

@property label - Диагностическое имя bounded operation.

@property [hardKillDelayMs=250] - Grace между TERM и KILL exact handle.

@property [outputLimit=65536] - Максимум байтов каждого стандартного captured stream.

@property [readStdout] - Event-driven consumer для JSONL worker transport.
*/
export type StorybookOwnedChildWaitInput = Readonly<{
  child: StorybookOwnedChildHandle
  signal: AbortSignal
  timeoutMs: number
  label: string
  processGroup?: Readonly<{leaderPid: number}>
  hardKillDelayMs?: number
  outputLimit?: number
  readStdout?: StorybookOwnedChildStdoutReader
}>

/**
Ожидает exact spawned child и подтверждает его завершение при success, abort и timeout.

Helper никогда не ищет процессы по PID/command и не сигналит descendants или чужие
processes. Владелец worker обязан сам завершить принадлежащих ему descendants по
своему AbortSignal; увеличенный parent grace даёт ему время подтвердить cleanup.

@throws Исходная abort reason либо `TimeoutError` после подтверждённого exit.
*/
export async function waitForStorybookOwnedChild(
  input: StorybookOwnedChildWaitInput,
): Promise<StorybookOwnedChildResult> {
  const hardKillDelayMs = input.hardKillDelayMs ?? 250
  const outputLimit = input.outputLimit ?? 64 * 1024
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new RangeError(`Storybook child timeout must be positive: ${input.timeoutMs}`)
  }
  if (!Number.isFinite(hardKillDelayMs) || hardKillDelayMs < 0) {
    throw new RangeError(`Storybook child hard-kill delay cannot be negative: ${hardKillDelayMs}`)
  }
  if (input.processGroup !== undefined && (
    process.platform === "win32" || input.processGroup.leaderPid !== input.child.pid || input.child.pid <= 0
  )) {
    throw new Error("Storybook owned process group must be an exact detached Unix child leader")
  }
  let timedOut = false
  let abortReason: unknown = null
  let terminationRequested = false
  let readerError: unknown = null
  let hardKill: ReturnType<typeof setTimeout> | null = null
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
          // Exact owned process или group уже завершились.
        }
      }, hardKillDelayMs)
    } catch {
      // Exact owned process или group уже завершились.
    }
  }
  const onAbort = (): void => terminate(input.signal.reason, false)
  input.signal.addEventListener("abort", onAbort, {once: true})
  if (input.signal.aborted) onAbort()
  const timer = setTimeout(() => terminate(
    new Error(`${input.label} timed out after ${input.timeoutMs}ms`),
    true,
  ), input.timeoutMs)
  try {
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
        ? readBoundedStorybookChildStream(input.child.stdout, outputLimit)
        : input.readStdout(input.child.stdout)),
      protectReader(readBoundedStorybookChildStream(input.child.stderr, outputLimit)),
    ])
    if (terminationRequested && input.processGroup !== undefined) {
      await confirmOwnedProcessGroupExit(input.processGroup.leaderPid, hardKillDelayMs)
    }
    if (!terminationRequested && input.processGroup !== undefined &&
      ownedProcessGroupExists(input.processGroup.leaderPid)) {
      try {
        process.kill(-input.processGroup.leaderPid, "SIGKILL")
      } catch (error) {
        if (!isMissingProcessError(error)) throw error
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

/** Сигналит exact handle либо detached group, явно принадлежащую тому же leader. */
function signalOwnedProcess(
  input: StorybookOwnedChildWaitInput,
  signal: "SIGTERM" | "SIGKILL",
): void {
  if (input.processGroup === undefined) {
    input.child.kill(signal === "SIGKILL" ? 9 : undefined)
    return
  }
  process.kill(-input.processGroup.leaderPid, signal)
}

/**
Bounded подтверждает исчезновение detached group после leader exit.

После TERM helper ждёт не дольше grace, повторяет SIGKILL exact PGID и даёт ядру
короткое окно убрать оставшихся descendants. PID не разрешается заново по command.
*/
async function confirmOwnedProcessGroupExit(leaderPid: number, graceMs: number): Promise<void> {
  const termDeadline = Date.now() + graceMs
  while (ownedProcessGroupExists(leaderPid) && Date.now() < termDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  if (!ownedProcessGroupExists(leaderPid)) return
  try {
    process.kill(-leaderPid, "SIGKILL")
  } catch (error) {
    if (!isMissingProcessError(error)) throw error
  }
  const killDeadline = Date.now() + 1_000
  while (ownedProcessGroupExists(leaderPid) && Date.now() < killDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
  if (ownedProcessGroupExists(leaderPid)) {
    throw new Error(`Storybook owned process group ${leaderPid} did not exit after SIGKILL`)
  }
}

/** Проверяет существование exact PGID без перечисления host processes. */
function ownedProcessGroupExists(leaderPid: number): boolean {
  try {
    process.kill(-leaderPid, 0)
    return true
  } catch (error) {
    if (isMissingProcessError(error)) return false
    throw error
  }
}

/** ESRCH означает, что exact PID/PGID больше не существует. */
function isMissingProcessError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ESRCH"
}

/** Сохраняет не более limit байтов, но продолжает дренировать pipe до EOF. */
export async function readBoundedStorybookChildStream(
  stream: unknown,
  limit: number,
): Promise<string> {
  if (stream === null || stream === undefined || typeof stream === "number") return ""
  const reader = (stream as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (length >= limit) continue
      const remaining = limit - length
      const chunk = next.value.byteLength <= remaining ? next.value : next.value.slice(0, remaining)
      chunks.push(chunk)
      length += chunk.byteLength
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  }
  const value = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    value.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(value)
}
