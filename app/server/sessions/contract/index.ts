import type {Zavx0zStorybookPackageSession} from "@zavx0z/storybook-package-session"
import type {Zavx0zStorybookPackageBuildScheduler} from "@zavx0z/storybook-package-build-scheduler"

/** Контракт композиции независимых пакетных сессий приложения. */
export declare namespace Zavx0zStorybookAppServerSessions {
  /**
  Исполнение и хранилище общие, состояние ревизии принадлежит конкретному пакету.
  @property artifactRoot - Каталог результатов всех сессий; каждый пакет получает собственную область.
  @property buildRevision - Предоставленная операция подготовки одной ревизии.
  @property [prepareBuild] - Проверяет готовность среды до занятия compiler slot.
  @property [readDescriptor] - Загружает входы выбранного пакета с ФС при обращении к ним вместо удержания полного каталога сессиями.
  @property [publish] - Наблюдает события владельцев сессий.
  @property [buildScheduler] - Общая очередь с внешним временем жизни.
  @property [buildConcurrency] - Лимит собственной очереди, если она не передана.
  @property [activationTimeoutMs] - Бюджет подтверждения применения в миллисекундах.
  @property [retainedRevisionLimit] - Число удерживаемых прежних ревизий.
  */
  type Input = Readonly<{
    artifactRoot: string
    buildRevision: Zavx0zStorybookPackageSession.Input[1]["buildRevision"]
    readDescriptor?: (packageId: string) => Zavx0zStorybookPackageSession.Input[0]
    prepareBuild?: Zavx0zStorybookPackageSession.Input[1]["prepareBuild"]
    publish?: Zavx0zStorybookPackageSession.Input[1]["publish"]
    buildScheduler?: Zavx0zStorybookPackageBuildScheduler.Output
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
    sync(descriptors: readonly Zavx0zStorybookPackageSession.Input[0][], failures?: ReadonlyMap<string, string>): void
    session(packageId: string): Zavx0zStorybookPackageSession.Output
    ensure(packageId: string, demand?: Parameters<Zavx0zStorybookPackageSession.Output["ensureBuilt"]>[0]): Promise<ReturnType<Zavx0zStorybookPackageSession.Output["snapshot"]>>
    retryFailed(packageId: string): boolean
    snapshots(): readonly ReturnType<Zavx0zStorybookPackageSession.Output["snapshot"]>[]
    build(packageId: string, demand?: Parameters<Zavx0zStorybookPackageSession.Output["build"]>[0]): Promise<ReturnType<Zavx0zStorybookPackageSession.Output["snapshot"]>>
    readonly buildScheduler: Zavx0zStorybookPackageBuildScheduler.Output
    buildSchedulerSnapshot(options?: Parameters<Zavx0zStorybookPackageBuildScheduler.Output["snapshot"]>[0]): ReturnType<Zavx0zStorybookPackageBuildScheduler.Output["snapshot"]>
    dispose(): Promise<void>
  }
}
