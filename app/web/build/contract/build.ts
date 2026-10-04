import type {Zavx0zStorybookTechBuildEnvironment} from "@zavx0z/storybook-tech-build-environment"
import type Scheduler from "@zavx0z/storybook-package-build-scheduler"
import type {Zavx0zStorybookPackageBuildScheduler} from "@zavx0z/storybook-package-build-scheduler"

/** Фазы одной общей сборки из публичного worker-протокола планировщика. */
export type SharedBrowserBuildPhaseListener = (event: Extract<
  NonNullable<ReturnType<typeof Scheduler.parseStorybookBuildWorkerTransportEvent>>,
  {kind: "phase"}
>["event"]) => void

/** Контекст уже допущенной scheduler операции. */
export type SharedBrowserBuildOperationContext = Parameters<Parameters<Zavx0zStorybookPackageBuildScheduler.Output["run"]>[1]>[0]

/**
Файловый вход одной сборки общей оболочки.

@property root - Каталог сохранения immutable hashed assets.

@property toolRoot - Канонический checkout владельца компилятора и оболочки.

@property landingEntryPath - Исходник главной страницы.

@property fallbackEntryPath - Исходник страницы до применения пакетной ревизии.

@property sharedKernel - Готовая платформа;
её модули используются как external imports, повторная компиляция kernel не выполняется.

@property stagingDirectory - Изолированный каталог только текущей операции.
*/
export interface SharedBrowserBuildInput {
  readonly root: string
  readonly toolRoot: string
  readonly landingEntryPath: string
  readonly fallbackEntryPath: string
  readonly packageEntryPath?: string
  readonly sharedKernel: ReturnType<Zavx0zStorybookTechBuildEnvironment.Output["identity"]>
  /** Полный набор готовых файлов платформы в root; Web не создаёт их заново. */
  readonly kernelArtifacts: Awaited<ReturnType<Zavx0zStorybookTechBuildEnvironment.Output["build"]>>["artifacts"]
  readonly stagingDirectory: string
}
