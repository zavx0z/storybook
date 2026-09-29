import {resolve} from "node:path"
import {StorybookBuildSemaphore} from "../build/build-semaphore.ts"
import {
  StorybookBuildScheduler,
  type StorybookBuildSchedulerSnapshot,
} from "../build/build-scheduler.ts"
import {
  StorybookPackageSession,
  storybookDiagnostic,
  type StorybookPackageBuildDescriptor,
  type StorybookPackageEvent,
  type StorybookPackageBuildDemand,
  type StorybookPackageRevisionBuilder,
  type StorybookPackageSessionSnapshot,
  type StorybookPackageInputFingerprintVerifier,
} from "./package-session.ts"

export type ExternalStorybookSessionManagerOptions = Readonly<{
  artifactRoot: string
  buildRevision: StorybookPackageRevisionBuilder
  /** Общие зависимости подготавливаются вне compiler slot пакета. */
  prepareBuild?(signal: AbortSignal): Promise<void>
  verifyInputFingerprint?: StorybookPackageInputFingerprintVerifier
  publish?(event: StorybookPackageEvent): void
  buildScheduler?: StorybookBuildScheduler
  /** @deprecated Use buildScheduler. */
  buildSemaphore?: StorybookBuildSemaphore
  buildConcurrency?: number
  compileTimeoutMs?: number
  activationTimeoutMs?: number
  retainedRevisionLimit?: number
}>

/** Owns PackageSessions as a derived runtime view of the canonical graph. */
export class ExternalStorybookSessionManager {
  readonly #artifactRoot: string
  readonly #buildRevision: StorybookPackageRevisionBuilder
  readonly #prepareBuild: ((signal: AbortSignal) => Promise<void>) | undefined
  readonly #verifyInputFingerprint: StorybookPackageInputFingerprintVerifier | undefined
  readonly #publish: (event: StorybookPackageEvent) => void
  readonly #buildScheduler: StorybookBuildScheduler
  readonly #ownsBuildScheduler: boolean
  readonly #compileTimeoutMs: number | undefined
  readonly #activationTimeoutMs: number | undefined
  readonly #retainedRevisionLimit: number | undefined
  readonly #sessions = new Map<string, StorybookPackageSession>()
  #disposed = false
  #disposePromise: Promise<void> | null = null

  constructor(options: ExternalStorybookSessionManagerOptions) {
    this.#artifactRoot = resolve(options.artifactRoot)
    this.#buildRevision = options.buildRevision
    this.#prepareBuild = options.prepareBuild
    this.#verifyInputFingerprint = options.verifyInputFingerprint
    this.#publish = options.publish ?? (() => {})
    this.#compileTimeoutMs = options.compileTimeoutMs
    this.#activationTimeoutMs = options.activationTimeoutMs
    this.#retainedRevisionLimit = options.retainedRevisionLimit
    if (options.buildScheduler !== undefined && options.buildSemaphore !== undefined) {
      throw new Error("Storybook SessionManager accepts one build scheduler")
    }
    this.#ownsBuildScheduler = options.buildScheduler === undefined && options.buildSemaphore === undefined
    this.#buildScheduler = options.buildScheduler ?? options.buildSemaphore ?? new StorybookBuildScheduler(
      options.buildConcurrency === undefined ? {} : {limit: options.buildConcurrency},
    )

  }

  sync(descriptors: readonly StorybookPackageBuildDescriptor[], failures: ReadonlyMap<string, string> = new Map()): void {
    this.#assertActive()
    const nextIds = new Set<string>()
    for (const descriptor of descriptors) {
      if (nextIds.has(descriptor.packageId)) {
        throw new Error(`Duplicate Storybook PackageSession descriptor: ${descriptor.packageId}`)
      }
      nextIds.add(descriptor.packageId)
    }
    for (const [packageId, session] of this.#sessions) {
      if (nextIds.has(packageId)) continue
      void session.dispose()
      this.#sessions.delete(packageId)
    }
    for (const descriptor of descriptors) {
      const current = this.#sessions.get(descriptor.packageId)
      if (current === undefined) {
        const session = new StorybookPackageSession(descriptor, {
          artifactRoot: this.#artifactRoot,
          buildRevision: this.#buildRevision,
          ...(this.#verifyInputFingerprint === undefined ? {} : {verifyInputFingerprint: this.#verifyInputFingerprint}),
          ...(this.#prepareBuild === undefined ? {} : {prepareBuild: this.#prepareBuild}),
          buildScheduler: this.#buildScheduler,
          ...(this.#compileTimeoutMs === undefined ? {} : {compileTimeoutMs: this.#compileTimeoutMs}),
          ...(this.#activationTimeoutMs === undefined ? {} : {activationTimeoutMs: this.#activationTimeoutMs}),
          ...(this.#retainedRevisionLimit === undefined ? {} : {retainedRevisionLimit: this.#retainedRevisionLimit}),
          publish: (event) => this.#onSessionEvent(event),
        })
        this.#sessions.set(descriptor.packageId, session)
      } else if (!failures.has(descriptor.packageId)) {
        current.reconfigure(descriptor)
      }
      this.#sessions.get(descriptor.packageId)!.setResolutionError(failures.get(descriptor.packageId) ?? null)
    }
  }

  session(packageId: string): StorybookPackageSession {
    this.#assertActive()
    const session = this.#sessions.get(packageId)
    if (session === undefined) throw new Error(`Unknown Storybook PackageSession: ${packageId}`)
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
  Перепроверяет current fingerprint одной session перед explicit check.

  @returns `true`, если session обнаружила mismatch и продвинула generation.
  */
  revalidateInputs(packageId: string): boolean {
    return this.session(packageId).revalidateInputs()
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
