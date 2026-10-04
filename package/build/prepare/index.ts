/** Строит независимую package revision в готовой общей среде Storybook.

@packageDocumentation
*/
import PackageSessionOwner from "@storybook-package/session"
import BuildEnvironmentOwner, {type StorybookTechBuildEnvironment as BuildEnvironmentContract} from "@storybook-tech-build/environment"
const storybookBuildError = PackageSessionOwner.buildError
const storybookDiagnostic = PackageSessionOwner.diagnostic
const validateStorybookSharedBrowserIdentity = BuildEnvironmentOwner.validate
type StorybookSharedBrowserIdentity = ReturnType<BuildEnvironmentContract.Output["identity"]>
import {realpathSync} from "node:fs"
import {join} from "node:path"
import runBuildWorker from "@storybook-tech-build/worker"
import Scheduler from "@storybook-package-build/scheduler"
import {buildStorybookPackageRevisionInProcess} from "./src/in-process"
import type {StorybookPackageBuildPrepare} from "./contract"
import type {BuilderInput, BuildResult, PhaseListener, WorkerLifecycleListener} from "./contract/build"
import type {WorkerJob, WorkerResult} from "./src/worker-protocol"

export type {StorybookPackageBuildPrepare} from "./contract"

const {parseStorybookBuildWorkerTransportEvent} = Scheduler

/** Создаёт реальный Bun browser builder для независимых `StorybookPackageSession`. */
export default function createStorybookPackageRevisionBuilder(
  options: StorybookPackageBuildPrepare.Input,
): StorybookPackageBuildPrepare.Output {
  const toolRoot = realpathSync(options.toolRoot)
  const browserEntryPath = realpathSync(options.browserEntryPath)
  const workerPath = realpathSync(options.workerPath ?? join(toolRoot, "package/build/prepare/src/package-build-worker.ts"))
  if (options.resolveCompilerPlugins !== undefined) {
    return async (input) => {
      const sharedBrowserIdentity = await resolveSharedBrowserIdentity(options)
      return buildStorybookPackageRevisionInProcess(input, {
        ...options,
        toolRoot,
        browserEntryPath,
        ...(sharedBrowserIdentity === undefined ? {} : {sharedBrowserIdentity}),
      })
    }
  }
  return async (input) => {
    const sharedBrowserIdentity = await resolveSharedBrowserIdentity(options)
    return runPackageBuildWorker(
      input,
      {
        toolRoot,
        browserEntryPath,
        ...(sharedBrowserIdentity === undefined ? {} : {sharedBrowserIdentity}),
      },
      workerPath,
      options.onPhase,
      options.onWorkerLifecycle,
    )
  }
}

/** Передаёт пакетное задание исполнителю и проверяет предметный результат после очистки worker. */
async function runPackageBuildWorker(
  input: BuilderInput,
  options: Readonly<{
    toolRoot: string
    browserEntryPath: string
    sharedBrowserIdentity?: StorybookSharedBrowserIdentity
  }>,
  workerPath: string,
  onPhase?: PhaseListener,
  onWorkerLifecycle?: WorkerLifecycleListener,
): Promise<BuildResult> {
  const {
    signal,
    onPhase: inputOnPhase,
    onWorkerLifecycle: inputOnWorkerLifecycle,
    ...serializableInput
  } = input
  const phaseListener = inputOnPhase ?? onPhase
  const lifecycleListener = inputOnWorkerLifecycle ?? onWorkerLifecycle
  const job: WorkerJob = Object.freeze({input: serializableInput, options})
  const execution = await runBuildWorker({
    entryPath: workerPath,
    cwd: input.descriptor.repo,
    temporaryRoot: input.stagingDirectory,
    createJob: () => job,
    signal,
    label: "Storybook package compile",
    parseEvent: parseStorybookBuildWorkerTransportEvent,
    streamMode: "tolerant",
    ...(phaseListener === undefined ? {} : {onProgress: phaseListener}),
    ...(lifecycleListener === undefined ? {} : {onLifecycle: lifecycleListener}),
  })
  if (execution.result === undefined) {
    throw storybookBuildError(storybookDiagnostic(
      "compile",
      execution.stderr.trim() || `Storybook package build worker exited ${execution.exitCode} without a result`,
    ))
  }
  const result = execution.result as WorkerResult
  if (result.ok) return result.build
  const diagnostics = result.diagnostics.flatMap((diagnostic) =>
    isWorkerDiagnosticPhase(diagnostic.phase)
      ? [storybookDiagnostic(diagnostic.phase, diagnostic.message, diagnostic.path)]
      : [])
  throw storybookBuildError(diagnostics.length > 0
    ? diagnostics
    : storybookDiagnostic("compile", result.message))
}

async function resolveSharedBrowserIdentity(
  options: StorybookPackageBuildPrepare.Input,
): Promise<StorybookSharedBrowserIdentity | undefined> {
  if (options.sharedBrowserIdentity !== undefined) {
    return validateStorybookSharedBrowserIdentity(options.sharedBrowserIdentity)
  }
  if (options.resolveSharedBrowserIdentity === undefined) return undefined
  return validateStorybookSharedBrowserIdentity(await options.resolveSharedBrowserIdentity())
}

function isWorkerDiagnosticPhase(
  value: string,
): value is Parameters<typeof storybookDiagnostic>[0] {
  return ["resolve", "validate", "compile", "link", "protocol", "publish", "activation", "timeout"]
    .includes(value)
}
