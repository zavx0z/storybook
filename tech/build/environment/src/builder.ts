import {dirname, join} from "node:path"
import runWorker from "@storybook-tech-build/worker"
import Scheduler from "@storybook-package-build/scheduler"
import {validatePlatformArtifacts} from "./build"
import type {PlatformArtifacts, PlatformBuildInput, PlatformBuildContext} from "../contract/build"

/** Исполняет явную подготовку платформы в предоставленном slot общей очереди. */
export async function runPlatformBuild(input: Omit<PlatformBuildInput, "stagingDirectory">, context: PlatformBuildContext): Promise<PlatformArtifacts> {
  let release: (() => void) | undefined
  try {
    const result = await runWorker({
      entryPath: join(import.meta.dir, "worker.ts"), cwd: input.toolRoot, temporaryRoot: dirname(input.root),
      createJob: ({directory}) => ({...input, stagingDirectory: join(directory, "staging")}),
      signal: context.signal, label: "Browser platform build", streamMode: "strict", maxResultBytes: 8 * 1024 * 1024,
      parseEvent: Scheduler.parseStorybookBuildWorkerTransportEvent,
      onProgress(event) { if (event.state === "started") context.setPhase(event.phase) },
      onLifecycle(event) {
        if (event.state === "started") release = context.bindWorker({pid: event.pid, startedAt: event.startedAt})
        else {
          release?.()
          release = undefined
        }
      },
    })
    const value = result.result as PlatformArtifacts & {error?: string} | undefined
    if (!result.ready || result.exitCode !== 0 || value === undefined) {
      throw new Error(value?.error ?? (result.stderr.trim() || `Platform worker failed: ${result.exitCode}`))
    }
    return validatePlatformArtifacts(input.root, value)
  } finally { release?.() }
}
