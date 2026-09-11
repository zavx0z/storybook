import {randomUUID} from "node:crypto"
import {mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from "node:fs"
import {dirname, isAbsolute, join, relative} from "node:path"
import {fileURLToPath} from "node:url"
import {waitForStorybookOwnedChild} from "./child-process.ts"
import {parseStorybookBuildWorkerTransportEvent} from "./build-phase.ts"
import type {StorybookBuildOperationContext} from "./build-scheduler.ts"
import type {SharedBrowserAssets} from "./shared-browser-assets.ts"
import type {SharedBrowserBuildInput} from "./types/shared-browser.ts"
import {validateStorybookSharedBrowserIdentity} from "./shared-module-identity.ts"

/**
Выполняет общую browser-сборку внутри уже выделенного scheduler slot.

@param input - Канонические исходники и каталог результата общей оболочки.

@param context - Владение операцией, отмена и привязка измерений процесса.

@param timeoutMs - Бюджет исполнения после admission, без времени ожидания очереди.

@returns Проверенный результат exact worker; временные файлы удаляются после exit.

@throws Ошибка handshake, сборки, отмены, таймаута или выход результата за каталог.
*/
export async function runSharedBrowserBuild(
  input: Omit<SharedBrowserBuildInput, "stagingDirectory">,
  context: StorybookBuildOperationContext,
  timeoutMs: number,
): Promise<SharedBrowserAssets> {
  context.signal.throwIfAborted()
  const workerId = randomUUID()
  const jobRoot = join(dirname(input.root), `.shared-job-${workerId}`)
  const stagingDirectory = join(jobRoot, "staging")
  const jobPath = join(jobRoot, "input.json")
  const resultPath = join(jobRoot, "result.json")
  mkdirSync(jobRoot, {recursive: true, mode: 0o700})
  let release: (() => void) | undefined
  try {
    writeFileSync(jobPath, JSON.stringify({...input, stagingDirectory}), {mode: 0o600})
    const workerStartedAt = new Date().toISOString()
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./shared-browser-worker.ts", import.meta.url)), jobPath, resultPath, workerId], {
      cwd: input.toolRoot,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    })
    let ready = false
    const result = await waitForStorybookOwnedChild({
      child,
      signal: context.signal,
      timeoutMs,
      label: "Shared browser build",
      hardKillDelayMs: 1_000,
      processGroup: {leaderPid: child.pid},
      async readStdout(stream) {
        if (!(stream instanceof ReadableStream)) throw new Error("Shared worker stdout is unavailable")
        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let pending = ""
        try {
          for (;;) {
            const part = await reader.read()
            if (part.done) break
            pending += decoder.decode(part.value, {stream: true})
            if (pending.length > 65_536) throw new Error("Shared worker handshake exceeds limit")
            let end: number
            while ((end = pending.indexOf("\n")) !== -1) {
              const line = pending.slice(0, end)
              pending = pending.slice(end + 1)
              if (line.trim() === "") continue
              const event = parseStorybookBuildWorkerTransportEvent(JSON.parse(line))
              if (event?.kind === "phase" && ready) {
                if (event.event.state === "started") context.setPhase(event.event.phase)
                if (event.event.cache !== undefined) context.setCacheOutcome?.(event.event.cache)
                continue
              }
              if (event?.kind !== "ready" || ready || event.workerId !== workerId || event.pid !== child.pid) {
                throw new Error("Shared worker handshake does not match its owned process")
              }
              ready = true
              release = context.bindWorker({pid: child.pid, startedAt: workerStartedAt})
              context.setPhase("fingerprint")
            }
          }
          if (pending.trim() !== "") throw new Error("Shared worker emitted an incomplete handshake")
          return ""
        } finally { reader.releaseLock() }
      },
    })
    if (!ready || result.exitCode !== 0) throw new Error(result.stderr.trim() || "Shared browser worker failed")
    if (statSync(resultPath).size > 1_048_576) throw new Error("Shared browser result exceeds limit")
    const value = JSON.parse(readFileSync(resultPath, "utf8")) as SharedBrowserAssets
    if (value.root !== input.root || !Array.isArray(value.dependencyRealpaths) ||
      value.dependencyRealpaths.some(path => typeof path !== "string" || !isAbsolute(path))) {
      throw new Error("Shared browser result has an invalid owner or dependency list")
    }
    for (const entry of [value.landingEntry, value.fallbackEntry]) {
      if (typeof entry !== "string" || isAbsolute(entry)) throw new Error("Shared browser entry must be relative")
      const local = relative(realpathSync(input.root), realpathSync(join(input.root, entry)))
      if (!local || local.startsWith("..") || isAbsolute(local)) throw new Error("Shared browser entry escaped its owner")
    }
    if (value.browserIdentity === undefined) throw new Error("Shared browser result has no module identity")
    const browserIdentity = validateStorybookSharedBrowserIdentity(value.browserIdentity)
    context.setCacheOutcome?.({status: value.cacheHit === true ? "hit" : "miss", layer: "shared"})
    if (value.cacheHit !== true) context.setPhase("publish")
    return Object.freeze({...value, browserIdentity})
  } finally {
    release?.()
    rmSync(jobRoot, {recursive: true, force: true})
  }
}
