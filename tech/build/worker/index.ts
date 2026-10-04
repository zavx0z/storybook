/**
Исполняет одну JSON-задачу в собственном дочернем процессе. Владеет временной
областью, транспортом событий и завершением точной группы процессов. Смысл
задачи, формат её событий и интерпретация результата остаются у вызывающего кода.

@packageDocumentation
*/
import {randomUUID} from "node:crypto"
import {chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import waitForOwnedChild from "@zavx0z/storybook-tech-process-wait"
import readWorkerEvents from "./src/read-events"
import readWorkerResult from "./src/read-result"
import notifyObserver from "./src/notify"
import type {StorybookTechBuildWorker} from "./contract"

export type {StorybookTechBuildWorker} from "./contract"

/**
Запускает worker через текущий Bun с argv: entryPath, input.json, result.json, workerId.
JSON вход создаётся в приватном каталоге с правами 0700, файл — 0600. Каталог
удаляется после завершения процесса и при ошибке подготовки; родитель и соседи сохраняются.

started публикуется после exact nonce/PID handshake. exited следует только
для подтверждённого started после settle ожидания и exact child.exited. Ошибка
подтверждения группы остаётся отказом операции, а не успешным результатом.
Поток и callbacks завершаются
до возврата. Ненулевой exitCode возвращается вместе с stderr и JSON результатом.

@throws Причина отмены, TimeoutError, ошибка подготовки, чтения потока или JSON результата.

@throws RangeError при неверном timeoutMs, maxResultBytes или hardKillDelayMs до создания процесса.
*/
export default async function runBuildWorker<Job, Progress>(
  input: StorybookTechBuildWorker.Input<Job, Progress>,
): Promise<StorybookTechBuildWorker.Output> {
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
    throw new RangeError(`Build worker timeout must be positive: ${input.timeoutMs}`)
  }
  if (input.hardKillDelayMs !== undefined &&
    (!Number.isFinite(input.hardKillDelayMs) || input.hardKillDelayMs < 0)) {
    throw new RangeError(`Build worker hard-kill delay cannot be negative: ${input.hardKillDelayMs}`)
  }
  if (input.maxResultBytes !== undefined &&
    (!Number.isSafeInteger(input.maxResultBytes) || input.maxResultBytes < 0)) {
    throw new RangeError(`Build worker result limit must be a nonnegative safe integer: ${input.maxResultBytes}`)
  }
  if (input.streamMode !== "strict" && input.streamMode !== "tolerant") {
    throw new TypeError("Build worker stream mode must be strict or tolerant")
  }
  if (!(input.signal instanceof AbortSignal)) {
    throw new TypeError("Build worker signal must be an AbortSignal")
  }
  if (process.platform === "win32") {
    throw new Error("Build worker requires detached Unix process groups")
  }
  input.signal.throwIfAborted()
  mkdirSync(input.temporaryRoot, {recursive: true})
  const directory = mkdtempSync(join(realpathSync(input.temporaryRoot), ".build-worker-"))
  try {
    chmodSync(directory, 0o700)
    const workerId = randomUUID()
    const jobPath = join(directory, "input.json")
    const resultPath = join(directory, "result.json")
    const job = input.createJob(Object.freeze({workerId, directory}))
    writeFileSync(jobPath, JSON.stringify(job), {mode: 0o600})
    input.signal.throwIfAborted()
    const startedAt = new Date().toISOString()
    const child = Bun.spawn([process.execPath, input.entryPath, jobPath, resultPath, workerId], {
      cwd: input.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    })
    let ready = false
    try {
      const {exitCode, stderr} = await waitForOwnedChild({
        child,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        label: input.label,
        hardKillDelayMs: input.hardKillDelayMs ?? 1_000,
        processGroup: {leaderPid: child.pid},
        readStdout: stream => readWorkerEvents(stream, {
          workerId,
          pid: child.pid,
          mode: input.streamMode,
          parseEvent: input.parseEvent,
          onReady() {
            ready = true
            notifyObserver(input.onLifecycle, Object.freeze({
              state: "started" as const,
              workerId,
              pid: child.pid,
              startedAt,
            }))
          },
          onProgress: event => notifyObserver(input.onProgress, event),
        }),
      })
      input.signal.throwIfAborted()
      return Object.freeze({
        workerId,
        ready,
        exitCode,
        stderr,
        result: readWorkerResult(resultPath, input.maxResultBytes),
      })
    } finally {
      const exitCode = await child.exited
      if (ready) {
        notifyObserver(input.onLifecycle, Object.freeze({
          state: "exited" as const,
          workerId,
          pid: child.pid,
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode,
        }))
      }
    }
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
}
