import {type PackageSession as PackageSessionContract} from "@package/session"
type StorybookPackageRevisionBuilder = PackageSessionContract.Input[1]["buildRevision"]
import type {BuildInputs} from "@build/inputs"
import type {BuildWorker} from "@build/worker"

type BuildInputFingerprint = BuildInputs.Output
type BuildWorkerLifecycleEvent = Parameters<NonNullable<BuildWorker.Input<unknown, unknown>["onLifecycle"]>>[0]

type TransportEvent = NonNullable<ReturnType<typeof import("@package-build/scheduler").default.parseStorybookBuildWorkerTransportEvent>>

export type PhaseEvent = Extract<TransportEvent, {kind: "phase"}>["event"]
export type PhaseListener = (event: PhaseEvent) => void
export type WorkerLifecycleListener = (event: BuildWorkerLifecycleEvent) => void
export type CompilerPluginResolver = (input: Readonly<{
  packageRoot: string
  projectRoot: string
  sourcePaths: readonly string[]
  generatedSourceRoot?: string
}>) => Promise<readonly Bun.BunPlugin[]>

export type BuilderInput = Readonly<Parameters<StorybookPackageRevisionBuilder>[0] & {
  onPhase?: PhaseListener
  onWorkerLifecycle?: WorkerLifecycleListener
}>

export type BuildResult = Readonly<Awaited<ReturnType<StorybookPackageRevisionBuilder>> & {
  inputFingerprint: BuildInputFingerprint
}>
