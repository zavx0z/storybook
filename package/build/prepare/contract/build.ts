import {type StorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
type StorybookPackageRevisionBuilder = PackageSessionContract.Input[1]["buildRevision"]
import type {StorybookTechBuildWorker} from "@zavx0z/storybook-tech-build-worker"

type BuildWorkerLifecycleEvent = Parameters<NonNullable<StorybookTechBuildWorker.Input<unknown, unknown>["onLifecycle"]>>[0]

type TransportEvent = NonNullable<ReturnType<typeof import("@zavx0z/storybook-package-build-scheduler").default.parseStorybookBuildWorkerTransportEvent>>

export type PhaseEvent = Extract<TransportEvent, {kind: "phase"}>["event"]
export type PhaseListener = (event: PhaseEvent) => void
export type WorkerLifecycleListener = (event: BuildWorkerLifecycleEvent) => void
export type CompilerPluginResolver = (input: Readonly<{
  packageRoot: string
  repo: string
  sourcePaths: readonly string[]
  generatedSourceRoot?: string
}>) => Promise<readonly Bun.BunPlugin[]>

export type BuilderInput = Readonly<Parameters<StorybookPackageRevisionBuilder>[0] & {
  onPhase?: PhaseListener
  onWorkerLifecycle?: WorkerLifecycleListener
}>

export type BuildResult = Readonly<Awaited<ReturnType<StorybookPackageRevisionBuilder>>>
