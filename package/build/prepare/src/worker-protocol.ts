import type {StorybookTechBuildEnvironment} from "@storybook-tech-build/environment"
import type {BuilderInput, BuildResult} from "../contract/build"

/** Private JSON job, передаваемый точному package compiler worker. */
export type WorkerJob = Readonly<{
  input: Omit<BuilderInput, "signal" | "onPhase" | "onWorkerLifecycle">
  options: Readonly<{
    toolRoot: string
    browserEntryPath: string
    sharedBrowserIdentity?: ReturnType<StorybookTechBuildEnvironment.Output["identity"]>
  }>
}>

/** Private JSON результат compiler worker до проверки владельцем Builder. */
export type WorkerResult = Readonly<{ok: true; build: BuildResult}> | Readonly<{
  ok: false
  message: string
  diagnostics: readonly Readonly<{phase: string; message: string; path: string | null}>[]
}>
