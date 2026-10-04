/**
Соединяет каталог с независимыми сессиями пакетов и общей очередью исполнения.

@packageDocumentation
*/
import PackageBuildSchedulerOwner, {type Zavx0zStorybookPackageBuildScheduler as PackageBuildSchedulerContract} from "@zavx0z/storybook-package-build-scheduler"
import PackageSessionOwner, {type Zavx0zStorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
const StorybookBuildScheduler = PackageBuildSchedulerOwner
const Zavx0zStorybookPackageSession = PackageSessionOwner
type StorybookBuildScheduler = PackageBuildSchedulerContract.Output
type StorybookBuildSchedulerSnapshot = ReturnType<PackageBuildSchedulerContract.Output["snapshot"]>
type Zavx0zStorybookPackageSession = PackageSessionContract.Output
type Zavx0zStorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
type StorybookPackageEvent = Parameters<NonNullable<PackageSessionContract.Input[1]["publish"]>>[0]
type StorybookPackageBuildDemand = NonNullable<Parameters<PackageSessionContract.Output["ensureBuilt"]>[0]>
type StorybookPackageRevisionBuilder = PackageSessionContract.Input[1]["buildRevision"]
type StorybookPackageSessionSnapshot = ReturnType<PackageSessionContract.Output["snapshot"]>
import {resolve} from "node:path"

import type {Zavx0zStorybookAppServerSessions} from "./contract"
export type {Zavx0zStorybookAppServerSessions} from "./contract"
/** Owns PackageSessions as a derived runtime view of the canonical graph. */
export default class ExternalStorybookSessionManager {
  readonly #artifactRoot: string
  readonly #buildRevision: StorybookPackageRevisionBuilder
  readonly #prepareBuild: ((signal: AbortSignal) => Promise<void>) | undefined
  readonly #readDescriptor: Zavx0zStorybookAppServerSessions.Input["readDescriptor"]
  readonly #publish: (event: StorybookPackageEvent) => void
  readonly #buildScheduler: StorybookBuildScheduler
  readonly #ownsBuildScheduler: boolean
  readonly #activationTimeoutMs: number | undefined
  readonly #retainedRevisionLimit: number | undefined
  readonly #descriptorInputs = new Map<string, Zavx0zStorybookPackageBuildDescriptor>()
  readonly #sessions = new Map<string, Zavx0zStorybookPackageSession>()
  #disposed = false
  #disposePromise: Promise<void> | null = null

  constructor(options: Zavx0zStorybookAppServerSessions.Input) {
    this.#artifactRoot = resolve(options.artifactRoot)
    this.#buildRevision = options.buildRevision
    this.#prepareBuild = options.prepareBuild
    this.#readDescriptor = options.readDescriptor
    this.#publish = options.publish ?? (() => {})
    this.#activationTimeoutMs = options.activationTimeoutMs
    this.#retainedRevisionLimit = options.retainedRevisionLimit
    this.#ownsBuildScheduler = options.buildScheduler === undefined
    this.#buildScheduler = options.buildScheduler ?? new StorybookBuildScheduler(
      options.buildConcurrency === undefined ? {} : {limit: options.buildConcurrency},
    )

  }

  sync(descriptors: readonly Zavx0zStorybookPackageBuildDescriptor[], failures: ReadonlyMap<string, string> = new Map()): void {
    this.#assertActive()
    const nextIds = new Set<string>()
    for (const descriptor of descriptors) {
      if (nextIds.has(descriptor.packageId)) {
        throw new Error(`Duplicate Storybook Zavx0zStorybookPackageSession descriptor: ${descriptor.packageId}`)
      }
      nextIds.add(descriptor.packageId)
    }
    for (const [packageId, session] of this.#sessions) {
      if (nextIds.has(packageId)) continue
      void session.dispose()
      this.#sessions.delete(packageId)
      this.#descriptorInputs.delete(packageId)
    }
    for (const descriptor of descriptors) {
      const current = this.#sessions.get(descriptor.packageId)
      if (current === undefined) {
        const session = new Zavx0zStorybookPackageSession(descriptor, {
          ...(this.#readDescriptor === undefined ? {} : {readDescriptor: () => this.#readDescriptor!(descriptor.packageId)}),
          artifactRoot: this.#artifactRoot,
          buildRevision: this.#buildRevision,
          ...(this.#prepareBuild === undefined ? {} : {prepareBuild: this.#prepareBuild}),
          buildScheduler: this.#buildScheduler,
          ...(this.#activationTimeoutMs === undefined ? {} : {activationTimeoutMs: this.#activationTimeoutMs}),
          ...(this.#retainedRevisionLimit === undefined ? {} : {retainedRevisionLimit: this.#retainedRevisionLimit}),
          publish: (event) => this.#onSessionEvent(event),
        })
        this.#sessions.set(descriptor.packageId, session)
        this.#descriptorInputs.set(descriptor.packageId, descriptor)
      } else if (!failures.has(descriptor.packageId) && this.#descriptorInputs.get(descriptor.packageId) !== descriptor) {
        current.reconfigure(descriptor)
        this.#descriptorInputs.set(descriptor.packageId, descriptor)
      }
      this.#sessions.get(descriptor.packageId)!.setResolutionError(failures.get(descriptor.packageId) ?? null)
    }
  }

  session(packageId: string): Zavx0zStorybookPackageSession {
    this.#assertActive()
    const session = this.#sessions.get(packageId)
    if (session === undefined) throw new Error(`Unknown Storybook Zavx0zStorybookPackageSession: ${packageId}`)
    return session
  }

  async ensure(
    packageId: string,
    demand?: StorybookPackageBuildDemand,
  ): Promise<StorybookPackageSessionSnapshot> {
    const session = this.session(packageId)
    const current = session.snapshot()
    if (current.diagnostics.some(diagnostic => diagnostic.phase === "resolve")) return current
    const active = current.revisions?.find(({revision}) => revision === current.activeRevision)
    if ((current.builtRevision !== null && current.builtRevision !== undefined) ||
      current.activatingRevision !== null && current.activatingRevision !== undefined ||
      active !== undefined && active.generation === current.generation) return current
    return session.ensureBuilt(demand)
  }

  retryFailed(packageId: string): boolean {
    return this.session(packageId).retryFailed()
  }

  snapshots(): readonly StorybookPackageSessionSnapshot[] {
    this.#assertActive()
    return Object.freeze([...this.#sessions.values()].map((session) => session.snapshot()))
  }

  /**
  Явно подготавливает новый результат выбранного пакета.
  Одновременные запросы ожидают одну работу, ошибка сохраняет прежнюю рабочую ревизию.

  @returns Состояние сессии после завершения запрошенной сборки.
  */
  build(packageId: string, demand?: StorybookPackageBuildDemand): Promise<StorybookPackageSessionSnapshot> {
    return this.session(packageId).build(demand)
  }

  /** Общий scheduler package и будущих shared jobs этого server lifecycle. */
  get buildScheduler(): StorybookBuildScheduler {
    return this.#buildScheduler
  }

  /**
  Возвращает global admission/load snapshot без compiler demand.

  @param options - `sampleResources` запрашивает один throttled process snapshot;
  отсутствие системных данных сохраняется как `null`.
  */
  buildSchedulerSnapshot(
    options: Readonly<{sampleResources?: boolean}> = {},
  ): StorybookBuildSchedulerSnapshot {
    this.#assertActive()
    return this.#buildScheduler.snapshot(options)
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== null) return this.#disposePromise
    this.#disposed = true
    const sessions = [...this.#sessions.values()]
    const pending = sessions.map((session) => session.dispose())
    this.#sessions.clear()
    this.#descriptorInputs.clear()
    this.#disposePromise = Promise.all(pending).then(() => {
      if (this.#ownsBuildScheduler) this.#buildScheduler.dispose()
    })
    return this.#disposePromise
  }

  #onSessionEvent(event: StorybookPackageEvent): void {
    try {
      this.#publish(event)
    } catch (error) {
      console.error(`Storybook package event publication failed for ${event.packageId}`, error)
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("External Storybook session manager is disposed")
  }
}
