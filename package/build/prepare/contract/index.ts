import {type Zavx0zStorybookTechBuildEnvironment as BuildEnvironmentContract} from "@zavx0z/storybook-tech-build-environment"
type StorybookSharedBrowserIdentity = ReturnType<BuildEnvironmentContract.Output["identity"]>
import type {BuilderInput, BuildResult, CompilerPluginResolver, PhaseListener, WorkerLifecycleListener} from "./build"

/** Контракт подготовки одной пакетной ревизии в готовой общей среде Storybook. */
export declare namespace Zavx0zStorybookPackageBuildPrepare {
  /**
  Параметры создания builder для одного tool owner.

  @property toolRoot - Канонический корень исполняемой сборочной системы.

  @property browserEntryPath - Явный вход browser host от приложения,
  выбравшего пакетную страницу.

  @property [workerPath] - Точный worker entry; по умолчанию
  `package/build/prepare/src/package-build-worker.ts` того же tool owner.

  @property [resolveCompilerPlugins] - Инъекция compiler plugins для
  исполнения в текущем процессе; без неё запускается isolated worker.

  @property [onPhase] - Получатель стадий сборки; исключения подавляются.

  @property [onWorkerLifecycle] - Получатель запуска и завершения точного child.

  @property [sharedBrowserIdentity] - Проверенная identity готовой общей среды.

  @property [resolveSharedBrowserIdentity] - Получает актуальную identity
  перед каждой работой, если fixed identity не задана.
  */
  type Input = Readonly<{
    toolRoot: string
    browserEntryPath: string
    workerPath?: string
    resolveCompilerPlugins?: CompilerPluginResolver
    onPhase?: PhaseListener
    onWorkerLifecycle?: WorkerLifecycleListener
    sharedBrowserIdentity?: StorybookSharedBrowserIdentity
    resolveSharedBrowserIdentity?(): Promise<StorybookSharedBrowserIdentity>
  }>

  /**
  Builder одной независимой package revision с повторным использованием
  готовой shared identity. Сигнал отмены и timeout принадлежат каждому вызову;
  ошибка подготовки отклоняет Promise; успешный результат описывает готовые модули.
  */
  type Output = (input: BuilderInput) => Promise<BuildResult>
}
