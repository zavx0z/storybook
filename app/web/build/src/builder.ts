import {realpathSync} from "node:fs"
import {dirname, isAbsolute, join, relative} from "node:path"
import runBuildWorker from "@zavx0z/storybook-tech-build-worker"
import Scheduler from "@zavx0z/storybook-package-build-scheduler"
import Environment from "@zavx0z/storybook-tech-build-environment"
import type {SharedBrowserAssets} from "../contract/assets"
import type {SharedBrowserBuildInput, SharedBrowserBuildOperationContext} from "../contract/build"
import {STORYBOOK_SHARED_ASSETS_MAX_BYTES} from "./receipt"


/**
Выполняет общую browser-сборку внутри уже выделенного scheduler slot.

@param input - Канонические исходники и каталог результата общей оболочки.

@param context - Владение операцией, отмена и привязка измерений процесса.

Ожидание завершается результатом, ошибкой процесса или отменой владельца; общего таймера сборки нет.

@returns Проверенный результат exact worker; временные файлы удаляются после exit.

@throws Ошибка handshake, сборки, отмены, таймаута или выход результата за каталог.
Сообщение штатного отказа читается из файла результата; предупреждения stderr его не вытесняют.
*/
export async function runSharedBrowserBuild(
  input: Omit<SharedBrowserBuildInput, "stagingDirectory">,
  context: SharedBrowserBuildOperationContext,
  workerPath = Environment.exactFile(join(import.meta.dir, "worker.ts")),
): Promise<SharedBrowserAssets> {
  let release: (() => void) | undefined
  try {
    const execution = await runBuildWorker({
      entryPath: workerPath,
      cwd: input.toolRoot,
      temporaryRoot: dirname(input.root),
      createJob: ({directory}) => ({...input, stagingDirectory: join(directory, "staging")}),
      signal: context.signal,
      label: "Shared browser build",
      parseEvent: Scheduler.parseStorybookBuildWorkerTransportEvent,
      streamMode: "strict",
      maxResultBytes: STORYBOOK_SHARED_ASSETS_MAX_BYTES,
      onProgress(event) {
        if (event.state === "started") context.setPhase(event.phase)
      },
      onLifecycle(event) {
        if (event.state === "started") {
          release = context.bindWorker({pid: event.pid, startedAt: event.startedAt})
          context.setPhase("resources")
        } else {
          release?.()
          release = undefined
        }
      },
    })
    if (!execution.ready || execution.result === undefined) {
      const detail = execution.stderr.trim()
      throw new Error(`Shared browser worker failed (exit ${execution.exitCode}, ready ${execution.ready}, result missing)${detail ? `: ${detail}` : ""}`)
    }
    const value = execution.result as SharedBrowserAssets & {error?: unknown}
    if (execution.exitCode !== 0) {
      throw new Error(typeof value.error === "string" ? value.error : execution.stderr.trim() || "Shared browser worker failed")
    }
    if (value.root !== input.root) throw new Error("Shared browser result has an invalid owner")
    for (const entry of [value.landingEntry, value.fallbackEntry]) {
      if (typeof entry !== "string" || isAbsolute(entry)) throw new Error("Shared browser entry must be relative")
      const local = relative(realpathSync(input.root), realpathSync(join(input.root, entry)))
      if (!local || local.startsWith("..") || isAbsolute(local)) throw new Error("Shared browser entry escaped its owner")
    }
    if (value.browserIdentity === undefined) throw new Error("Shared browser result has no module identity")
    const browserIdentity = Environment.validate(value.browserIdentity)
    context.setPhase("publish")
    return Object.freeze({...value, browserIdentity})
  } finally {
    release?.()
  }
}
