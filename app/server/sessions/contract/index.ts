import type {PackageSession} from "@package/session"
import type {PackageBuildScheduler} from "@package-build/scheduler"

/** Контракт композиции независимых пакетных сессий приложения. */
export declare namespace AppServerSessions {
  /**
  Исполнение и хранилище общие, состояние ревизии принадлежит конкретному пакету.
  @property artifactRoot - Каталог результатов всех сессий; каждый пакет получает собственную область.
  @property buildRevision - Предоставленная операция подготовки одной ревизии.
  @property [prepareBuild] - Проверяет готовность среды до занятия compiler slot.
  @property [verifyInputFingerprint] - Подтверждает сохранённые входы перед повторным использованием.
  @property [publish] - Наблюдает события владельцев сессий.
  @property [buildScheduler] - Общая очередь с внешним временем жизни.
  @property [buildConcurrency] - Лимит собственной очереди, если она не передана.
  @property [compileTimeoutMs] - Бюджет пакетного worker в миллисекундах.
  @property [activationTimeoutMs] - Бюджет подтверждения применения в миллисекундах.
  @property [retainedRevisionLimit] - Число удерживаемых прежних ревизий.
  */
  type Input = Readonly<{
    artifactRoot: string
    buildRevision: PackageSession.Input[1]["buildRevision"]
    prepareBuild?: PackageSession.Input[1]["prepareBuild"]
    verifyInputFingerprint?: PackageSession.Input[1]["verifyInputFingerprint"]
    publish?: PackageSession.Input[1]["publish"]
    buildScheduler?: PackageBuildScheduler.Output
    buildConcurrency?: number
    compileTimeoutMs?: number
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
  @property revalidateInputs - Перепроверяет существующее evidence перед явным check.
  @property buildScheduler - Возвращает используемую общую очередь.
  @property buildSchedulerSnapshot - Читает очередь и явно запрошенные измерения.
  @property dispose - Завершает все свои сессии; собственная очередь закрывается после очистки.
  */
  interface Output {
    sync(descriptors: readonly PackageSession.Input[0][], failures?: ReadonlyMap<string, string>): void
    session(packageId: string): PackageSession.Output
    ensure(packageId: string, demand?: Parameters<PackageSession.Output["ensureBuilt"]>[0]): Promise<ReturnType<PackageSession.Output["snapshot"]>>
    retryFailed(packageId: string): boolean
    snapshots(): readonly ReturnType<PackageSession.Output["snapshot"]>[]
    revalidateInputs(packageId: string): boolean
    readonly buildScheduler: PackageBuildScheduler.Output
    buildSchedulerSnapshot(options?: Parameters<PackageBuildScheduler.Output["snapshot"]>[0]): ReturnType<PackageBuildScheduler.Output["snapshot"]>
    dispose(): Promise<void>
  }
}
