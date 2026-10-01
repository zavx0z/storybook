import {realpathSync} from "node:fs"
import {dirname, isAbsolute, join, relative} from "node:path"
import runBuildWorker from "@build/worker"
import {parseStorybookBuildWorkerTransportEvent} from "./build-phase.ts"
import type {StorybookBuildOperationContext} from "./build-scheduler.ts"
import type {SharedBrowserAssets} from "./shared-browser-assets.ts"
import type {SharedBrowserBuildInput} from "./types/shared-browser.ts"
import {validateStorybookSharedBrowserIdentity} from "./shared-module-identity.ts"
import {STORYBOOK_SHARED_ASSETS_MAX_BYTES} from "./shared-browser-receipt"

/**
Выполняет общую browser-сборку внутри уже выделенного scheduler slot.

@param input - Канонические исходники и каталог результата общей оболочки.

@param context - Владение операцией, отмена и привязка измерений процесса.

@param timeoutMs - Бюджет исполнения после admission, без времени ожидания очереди.

@returns Проверенный результат exact worker; временные файлы удаляются после exit.

@throws Ошибка handshake, сборки, отмены, таймаута или выход результата за каталог.
Сообщение штатного отказа читается из файла результата; предупреждения stderr его не вытесняют.
*/
export async function runSharedBrowserBuild(
  input: Omit<SharedBrowserBuildInput, "stagingDirectory">,
  context: StorybookBuildOperationContext,
  timeoutMs: number,
): Promise<SharedBrowserAssets> {
  let release: (() => void) | undefined
  try {
    const execution = await runBuildWorker({
      entryPath: join(input.toolRoot, "build/shared-browser-worker.ts"),
      cwd: input.toolRoot,
      temporaryRoot: dirname(input.root),
      createJob: ({directory}) => ({...input, stagingDirectory: join(directory, "staging")}),
      signal: context.signal,
      timeoutMs,
      label: "Shared browser build",
      parseEvent: parseStorybookBuildWorkerTransportEvent,
      streamMode: "strict",
      maxResultBytes: STORYBOOK_SHARED_ASSETS_MAX_BYTES,
      onProgress(event) {
        if (event.state === "started") context.setPhase(event.phase)
        if (event.cache !== undefined) context.setCacheOutcome?.(event.cache)
      },
      onLifecycle(event) {
        if (event.state === "started") {
          release = context.bindWorker({pid: event.pid, startedAt: event.startedAt})
          context.setPhase("fingerprint")
        } else {
          release?.()
          release = undefined
        }
      },
    })
    if (!execution.ready || execution.result === undefined) {
      throw new Error(execution.stderr.trim() || "Shared browser worker failed")
    }
    const value = execution.result as SharedBrowserAssets & {error?: unknown}
    if (execution.exitCode !== 0) {
      throw new Error(typeof value.error === "string" ? value.error : execution.stderr.trim() || "Shared browser worker failed")
    }
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
    const browserIdentity = validateStorybookSharedBrowserIdentity(value.browserIdentity, input.sharedKernel === undefined)
    context.setCacheOutcome?.({status: value.cacheHit === true ? "hit" : "miss", layer: "shared"})
    if (value.cacheHit !== true) context.setPhase("publish")
    return Object.freeze({...value, browserIdentity})
  } finally {
    release?.()
  }
}
