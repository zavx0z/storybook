import type {StorybookSharedBrowserIdentity} from "./types"
import type {Zavx0zStorybookPackageBuildScheduler} from "@zavx0z/storybook-package-build-scheduler"
import type Scheduler from "@zavx0z/storybook-package-build-scheduler"

/** Вход явной компиляции общей платформы без browser-входов приложения. */
export type PlatformBuildInput = Readonly<{root: string, toolRoot: string, stagingDirectory: string}>

/** Готовые внешние зависимости Web; файлы уже опубликованы внутри root. */
export type PlatformArtifacts = Readonly<{
  identity: StorybookSharedBrowserIdentity
  artifacts: readonly Readonly<{path: string, digest: string}>[]
}>

export type PlatformBuildContext = Parameters<Parameters<Zavx0zStorybookPackageBuildScheduler.Output["run"]>[1]>[0]
export type PlatformPhaseListener = (event: Extract<NonNullable<ReturnType<typeof Scheduler.parseStorybookBuildWorkerTransportEvent>>, {kind: "phase"}>["event"]) => void
