import type {StorybookPackageSession} from "@storybook-package/session"
import type {StorybookPackageBuildScheduler} from "@storybook-package-build/scheduler"

/** Контракт композиции независимых пакетных сессий приложения. */
export declare namespace StorybookAppServerSessions {
  /**
  Исполнение и хранилище общие, состояние ревизии принадлежит конкретному пакету.
  @property artifactRoot - Каталог результатов всех сессий; каждый пакет получает собственную область.
  @property buildRevision - Предоставленная операция подготовки одной ревизии.
  @property [prepareBuild] - Проверяет готовность среды до занятия compiler slot.
  @property [publish] - Наблюдает события владельцев сессий.
  @property [buildScheduler] - Общая очередь с внешним временем жизни.
  @property [buildConcurrency] - Лимит собственной очереди, если она не передана.
  @property [activationTimeoutMs] - Бюджет подтверждения применения в миллисекундах.
  @property [retainedRevisionLimit] - Число удерживаемых прежних ревизий.
  */
  type Input = Readonly<{
    artifactRoot: string
    buildRevision: StorybookPackageSession.Input[1]["buildRevision"]
    prepareBuild?: StorybookPackageSession.Input[1]["prepareBuild"]
    publish?: StorybookPackageSession.Input[1]["publish"]
    buildScheduler?: StorybookPackageBuildScheduler.Output
    buildConcurrency?: number
    activationTimeoutMs?: number
    retainedRevisionLimit?: number
  }>

  /**
  Координатор одного набора сессий.
  @property sync - Согласует состав с каталогом и сохраняет существующие сессии неизменных владельцев.
  @property session - Возвращает точного владельца; неизвестный id отклоняется.
  @property ensure - Дожидается нужной ревизии без повторной работы для той же generation.
  @property retryFailed - Разрешает следующую явную попытку после неудачи.
  @property snapshots - Читает состояния без подготовки.
  @property build - Явно подготавливает новую ревизию; одновременные запросы используют одну работу.
  @property buildScheduler - Возвращает используемую общую очередь.
  @property buildSchedulerSnapshot - Читает очередь и явно запрошенные измерения.
  @property dispose - Завершает все свои сессии; собственная очередь закрывается после очистки.
  */
  interface Output {
    sync(descriptors: readonly StorybookPackageSession.Input[0][], failures?: ReadonlyMap<string, string>): void
    session(packageId: string): StorybookPackageSession.Output
    ensure(packageId: string, demand?: Parameters<StorybookPackageSession.Output["ensureBuilt"]>[0]): Promise<ReturnType<StorybookPackageSession.Output["snapshot"]>>
    retryFailed(packageId: string): boolean
    snapshots(): readonly ReturnType<StorybookPackageSession.Output["snapshot"]>[]
    build(packageId: string, demand?: Parameters<StorybookPackageSession.Output["build"]>[0]): Promise<ReturnType<StorybookPackageSession.Output["snapshot"]>>
    readonly buildScheduler: StorybookPackageBuildScheduler.Output
    buildSchedulerSnapshot(options?: Parameters<StorybookPackageBuildScheduler.Output["snapshot"]>[0]): ReturnType<StorybookPackageBuildScheduler.Output["snapshot"]>
    dispose(): Promise<void>
  }
}
