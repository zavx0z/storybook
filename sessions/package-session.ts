import {createHash, randomUUID} from "node:crypto"
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs"
import {isAbsolute, join, relative, resolve} from "node:path"
import {StorybookBuildSemaphore, storybookAbortError} from "../build/build-semaphore.ts"
import {
  StorybookBuildScheduler,
  type StorybookBuildCacheLayer,
  type StorybookBuildCacheStatus,
  type StorybookBuildOutcome,
  type StorybookBuildOwner,
  type StorybookBuildReason,
} from "../build/build-scheduler.ts"
import type {
  StorybookBuildPhaseListener,
  StorybookBuildWorkerLifecycleListener,
} from "../build/build-phase.ts"
import {
  parseStorybookBuildInputFingerprint,
  sameStorybookBuildInputFingerprint,
  storybookBuildInputFingerprintWatchPaths,
  type StorybookBuildInputFingerprint,
} from "../build/build-input-fingerprint.ts"
import {
  STORYBOOK_WATCH_CATEGORIES,
  type StorybookCategorizedWatchPath,
} from "./dependency-watch.ts"
import {
  validateStorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionGraphSnapshot,
} from "./package-revision.ts"
import {STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS} from "../server/timing.ts"

export type StorybookPackageModule = Readonly<{path: string, export: string}>
export type StorybookPackageVariantModule = Readonly<{route: string, module: StorybookPackageModule}>
export type StorybookPackageWidgetModule = Readonly<{id: string, module: StorybookPackageModule}>
export type StorybookPackageRevisionResourceFile = Readonly<{
  sourcePath: string
  sourceRoot?: string
  targetPath: string
  contentDigest?: string
  /** Derived text, published only after attesting its exact source bytes. */
  derivedContent?: string
}>

export type StorybookPackageBuildDescriptor = Readonly<{
  packageId: string
  packageRoot: string
  projectRoot: string
  sourcePath: string
  declarationDigest: string
  graphSnapshot: StorybookPackageRevisionGraphSnapshot
  resourceFiles?: readonly StorybookPackageRevisionResourceFile[]
  runtime: StorybookPackageModule | null
  variants: readonly StorybookPackageVariantModule[]
  widgetModules: readonly StorybookPackageWidgetModule[]
  watchedPaths?: readonly string[]
  watchPaths?: readonly StorybookCategorizedWatchPath[]
}>

export type StorybookPackageDiagnostic = Readonly<{
  phase: "resolve" | "validate" | "compile" | "link" | "protocol" | "publish" | "watch" | "activation" | "timeout"
  message: string
  path: string | null
}>

export type StorybookPackageBuildState =
  | "idle" | "queued" | "compiling" | "building" | "built" | "activating" | "active" | "failed" | "disposed" | "ready"
export type StorybookPackageRevisionStatus = "built" | "activating" | "working" | "failed"
export type StorybookPackageInputFreshness = "unknown" | "verified" | "unverified" | "changed"

export type StorybookPackageRevisionSnapshot = Readonly<{
  revision: string
  generation: number
  status: StorybookPackageRevisionStatus
  declarationDigest: string
  packageGraphDigest: string
  moduleGraphRevision: string
  entryRelativePath: string
  dependencyRealpaths: readonly string[]
  diagnostics: readonly StorybookPackageDiagnostic[]
  createdAt: string
  leases: number
}>

export type StorybookPackageSessionSnapshot = Readonly<{
  packageId: string
  declarationDigest: string
  moduleGraphRevision: string | null
  candidateRevision: string | null
  builtRevision?: string | null
  activatingRevision?: string | null
  activeRevision: string | null
  lastWorkingRevision?: string | null
  /** @deprecated Use lastWorkingRevision. */
  lastGoodRevision: string | null
  failedRevision?: string | null
  packageGraphDigest?: string
  generation?: number
  entryRelativePath: string | null
  diagnostics: readonly StorybookPackageDiagnostic[]
  dependencyRealpaths: readonly string[]
  revisions?: readonly StorybookPackageRevisionSnapshot[]
  subscribers: number
  buildState: StorybookPackageBuildState
  builds: number
  requestedGeneration?: number
  completedGeneration?: number
  pendingOperationId?: string | null
  lastBuildReason?: StorybookBuildReason | null
  lastQueueDurationMs?: number | null
  lastExecutionDurationMs?: number | null
  lastBuildOutcome?: StorybookBuildOutcome | null
  cacheOutcome?: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}> | null
  inputFreshness?: StorybookPackageInputFreshness
}>

/**
Причина demand, передаваемая package queue в общий scheduler.

Owner обозначает источник решения строить, а reason — проверяемую причину miss;
это не разрешение автоматически применять построенный candidate.
*/
export type StorybookPackageBuildDemand = Readonly<{
  owner: Exclude<StorybookBuildOwner, "shared">
  reason?: StorybookBuildReason
  cache?: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}>
}>

type NormalizedStorybookPackageBuildDemand = Readonly<{
  owner: Exclude<StorybookBuildOwner, "shared">
  reason: StorybookBuildReason
  cache?: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}>
}>

export type StorybookPackageEvent =
  | Readonly<{type: "package.built", packageId: string, revision: string, graphDigest: string}>
  | Readonly<{type: "package.code-updated", packageId: string, path: string}>
  | Readonly<{type: "package.resources-updated", packageId: string, path: string}>
  | Readonly<{type: "package.metadata-updated", packageId: string, path: string}>
  | Readonly<{type: "package.activating", packageId: string, revision: string, activationId: string}>
  | Readonly<{type: "package.updated", packageId: string, revision: string}>
  | Readonly<{
    type: "package.failed"
    packageId: string
    revision?: string
    diagnostics: readonly StorybookPackageDiagnostic[]
  }>
  | Readonly<{type: "package.detached", packageId: string}>

export type StorybookPackageRevisionBuild = Readonly<{
  moduleGraphRevision: string
  dependencyRealpaths: readonly string[]
  entryRelativePath: string
  inputFingerprint?: StorybookBuildInputFingerprint
}>

/**
Owner-provided проверка persisted fingerprint против текущего descriptor и bytes.

`null` означает любой unverifiable/mismatched случай и никогда не разрешает
выравнивать restored generation с текущей.
*/
export type StorybookPackageInputFingerprintVerifier = (
  value: unknown,
  descriptor: StorybookPackageBuildDescriptor,
) => StorybookBuildInputFingerprint | null

export type StorybookPackageRevisionBuilder = (input: Readonly<{
  descriptor: StorybookPackageBuildDescriptor
  generation: number
  candidateRevision: string
  revisionUrl: string
  stagingDirectory: string
  signal: AbortSignal
  compileTimeoutMs: number
  protocolTimeoutMs: number
  onPhase?: StorybookBuildPhaseListener
  onWorkerLifecycle?: StorybookBuildWorkerLifecycleListener
}>) => Promise<StorybookPackageRevisionBuild>

export type StorybookPackageActivation = Readonly<{
  activationId: string
  packageId: string
  revision: string
  viewId: string
  route: string
  packageGraphDigest: string
  deadline: string
}>

export type StorybookPackageSessionOptions = Readonly<{
  artifactRoot: string
  buildRevision: StorybookPackageRevisionBuilder
  /** Подготавливает общие зависимости до занятия единственного compiler slot. */
  prepareBuild?(signal: AbortSignal): Promise<void>
  verifyInputFingerprint?: StorybookPackageInputFingerprintVerifier
  publish?(event: StorybookPackageEvent): void
  buildScheduler?: StorybookBuildScheduler
  /** @deprecated Use buildScheduler. */
  buildSemaphore?: StorybookBuildSemaphore
  rebuildDelayMs?: number
  compileTimeoutMs?: number
  protocolTimeoutMs?: number
  activationTimeoutMs?: number
  retainedRevisionLimit?: number
}>

type RevisionRecord = {
  revision: string
  generation: number
  status: StorybookPackageRevisionStatus
  declarationDigest: string
  graphSnapshot: StorybookPackageRevisionGraphSnapshot
  moduleGraphRevision: string
  entryRelativePath: string
  dependencyRealpaths: readonly string[]
  inputFingerprint: StorybookBuildInputFingerprint | null
  diagnostics: readonly StorybookPackageDiagnostic[]
  createdAt: string
  activation: ActivationRecord | null
  leases: Set<string>
}

type ActivationRecord = {
  activationId: string
  viewId: string
  route: string
  deadline: string
  timer: ReturnType<typeof setTimeout>
}

type RunningBuild = Readonly<{generation: number, operationId: string, controller: AbortController}>

const DEFAULT_PROTOCOL_TIMEOUT_MS = 10_000
const DEFAULT_ACTIVATION_TIMEOUT_MS = 15_000
const DEFAULT_RETAINED_REVISION_LIMIT = 3

/** One independently queued, activated and diagnosable package boundary. */
export class StorybookPackageSession {
  #descriptor: StorybookPackageBuildDescriptor
  readonly #artifactRoot: string
  readonly #buildRevision: StorybookPackageRevisionBuilder
  readonly #prepareBuild: ((signal: AbortSignal) => Promise<void>) | undefined
  readonly #verifyInputFingerprint: StorybookPackageInputFingerprintVerifier | null
  readonly #publish: (event: StorybookPackageEvent) => void
  readonly #buildScheduler: StorybookBuildScheduler
  readonly #ownsBuildScheduler: boolean
  readonly #rebuildDelayMs: number
  readonly #compileTimeoutMs: number
  readonly #protocolTimeoutMs: number
  readonly #activationTimeoutMs: number
  readonly #retainedRevisionLimit: number
  readonly #revisions = new Map<string, RevisionRecord>()
  #generation = 1
  #completedGeneration = 0
  #requestedGeneration = 0
  #candidateRevision: string | null = null
  #builtRevision: string | null = null
  #activatingRevision: string | null = null
  #activeRevision: string | null = null
  #lastWorkingRevision: string | null = null
  #persistedAppliedRevision: string | null = null
  #failedRevision: string | null = null
  #diagnostics: readonly StorybookPackageDiagnostic[] = Object.freeze([])
  #resolutionError: string | null = null
  #buildState: StorybookPackageBuildState = "idle"
  #builds = 0
  #subscribers = 0
  #pendingOperationId: string | null = null
  #lastBuildReason: StorybookBuildReason | null = null
  #lastQueueDurationMs: number | null = null
  #lastExecutionDurationMs: number | null = null
  #lastBuildOutcome: StorybookBuildOutcome | null = null
  #cacheOutcome: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}> | null = null
  #inputFreshness: StorybookPackageInputFreshness = "unknown"
  readonly #generationDemands = new Map<number, NormalizedStorybookPackageBuildDemand>()
  #runner: Promise<void> | null = null
  #runningBuild: RunningBuild | null = null
  #rebuildTimer: ReturnType<typeof setTimeout> | null = null
  #disposed = false
  #disposePromise: Promise<void> | null = null

  constructor(descriptor: StorybookPackageBuildDescriptor, options: StorybookPackageSessionOptions) {
    this.#descriptor = normalizeDescriptor(descriptor)
    this.#artifactRoot = resolve(options.artifactRoot)
    this.#buildRevision = options.buildRevision
    this.#prepareBuild = options.prepareBuild
    this.#verifyInputFingerprint = options.verifyInputFingerprint ?? null
    this.#publish = options.publish ?? (() => {})
    if (options.buildScheduler !== undefined && options.buildSemaphore !== undefined) {
      throw new Error("Storybook PackageSession accepts one build scheduler")
    }
    this.#ownsBuildScheduler = options.buildScheduler === undefined && options.buildSemaphore === undefined
    this.#buildScheduler = options.buildScheduler ?? options.buildSemaphore ?? new StorybookBuildScheduler(1)
    this.#rebuildDelayMs = boundedDuration(options.rebuildDelayMs ?? 40, 0, 60_000, "rebuild delay")
    this.#compileTimeoutMs = boundedDuration(
      options.compileTimeoutMs ?? STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS, 100, 10 * 60_000, "compile timeout",
    )
    this.#protocolTimeoutMs = boundedDuration(
      options.protocolTimeoutMs ?? DEFAULT_PROTOCOL_TIMEOUT_MS, 100, 60_000, "protocol timeout",
    )
    this.#activationTimeoutMs = boundedDuration(
      options.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS, 100, 60_000, "activation timeout",
    )
    this.#retainedRevisionLimit = boundedDuration(
      options.retainedRevisionLimit ?? DEFAULT_RETAINED_REVISION_LIMIT, 0, 20, "retained revision limit",
    )
    this.#restoreApplied()
  }

  get packageId(): string {
    return this.#descriptor.packageId
  }

  get descriptor(): StorybookPackageBuildDescriptor {
    return this.#descriptor
  }

  /** Isolates declaration failures without retiring an already working revision. */
  setResolutionError(message: string | null): void {
    if (message === this.#resolutionError) return
    this.#resolutionError = message
    this.#cancelRebuildTimer()
    this.#advanceGeneration(
      "Storybook declaration changed",
      Object.freeze({owner: "watch", reason: "input-changed"}),
    )
    if (message !== null) {
      this.#publish(Object.freeze({type: "package.failed", packageId: this.packageId,
        diagnostics: Object.freeze([storybookDiagnostic("resolve", message.replaceAll(`${this.descriptor.packageRoot}/`, ""), this.descriptor.sourcePath)])}))
    } else if (this.#subscribers > 0) this.#requestCurrentGeneration()
  }

  reconfigure(descriptor: StorybookPackageBuildDescriptor): boolean {
    this.#assertActive()
    const next = normalizeDescriptor(descriptor)
    if (next.packageId !== this.packageId) {
      throw new Error(`Cannot reconfigure Storybook package identity ${this.packageId} as ${next.packageId}`)
    }
    if (sameDescriptor(this.#descriptor, next)) return false
    const hasSubscribers = this.#subscribers > 0
    this.#descriptor = next
    this.#cancelRebuildTimer()
    this.#advanceGeneration(
      "Storybook package reconfigured",
      Object.freeze({owner: "watch", reason: "input-changed"}),
      hasSubscribers,
    )
    if (hasSubscribers) this.#requestCurrentGeneration()
    return true
  }

  snapshot(): StorybookPackageSessionSnapshot {
    const selected = this.#record(this.#activeRevision) ??
      this.#record(this.#lastWorkingRevision) ?? this.#record(this.#builtRevision)
    return Object.freeze({
      packageId: this.descriptor.packageId,
      declarationDigest: this.descriptor.declarationDigest,
      moduleGraphRevision: selected?.moduleGraphRevision ?? null,
      candidateRevision: this.#candidateRevision,
      builtRevision: this.#builtRevision,
      activatingRevision: this.#activatingRevision,
      activeRevision: this.#activeRevision,
      lastWorkingRevision: this.#lastWorkingRevision,
      lastGoodRevision: this.#lastWorkingRevision,
      failedRevision: this.#failedRevision,
      packageGraphDigest: this.descriptor.graphSnapshot.packageGraphDigest,
      generation: this.#generation,
      entryRelativePath: selected?.entryRelativePath ?? null,
      diagnostics: this.#resolutionError === null ? this.#diagnostics : Object.freeze([storybookDiagnostic("resolve", this.#resolutionError.replaceAll(`${this.descriptor.packageRoot}/`, ""), this.descriptor.sourcePath)]),
      dependencyRealpaths: Object.freeze([...new Set([
        ...(selected?.dependencyRealpaths ?? []),
        ...(this.#record(this.#builtRevision)?.dependencyRealpaths ?? []),
        ...(this.#record(this.#failedRevision)?.dependencyRealpaths ?? []),
      ])]),
      revisions: Object.freeze([...this.#revisions.values()].map(revisionSnapshot)),
      subscribers: this.#subscribers,
      buildState: this.#resolutionError === null ? this.#buildState : "failed",
      builds: this.#builds,
      requestedGeneration: this.#requestedGeneration,
      completedGeneration: this.#completedGeneration,
      pendingOperationId: this.#pendingOperationId,
      lastBuildReason: this.#lastBuildReason,
      lastQueueDurationMs: this.#lastQueueDurationMs,
      lastExecutionDurationMs: this.#lastExecutionDurationMs,
      lastBuildOutcome: this.#lastBuildOutcome,
      cacheOutcome: this.#cacheOutcome,
      inputFreshness: this.#inputFreshness,
    })
  }

  /**
  Возвращает private watch projection всех retained fingerprint evidence.

  Пути не входят в public snapshot. Build-owner helper включает exact files и
  authoritative directories, где новый resolution candidate меняет inputs.
  */
  inputWatchPaths(): readonly string[] {
    return Object.freeze([...new Set([...this.#revisions.values()].flatMap(({inputFingerprint}) =>
      inputFingerprint === null ? [] : storybookBuildInputFingerprintWatchPaths(inputFingerprint) ?? []))].sort())
  }

  /**
  Синхронно перепроверяет current-generation evidence перед explicit check.

  Обычный open остаётся watcher-driven. При mismatch метод продвигает только
  generation этой session; `ensureBuilt()` затем ставит fresh candidate в общий
  scheduler. Отсутствие current revision не создаёт отдельную работу.

  @returns `true`, если mismatch продвинул generation и требуется fresh build.
  */
  revalidateInputs(): boolean {
    this.#assertActive()
    if (this.#resolutionError !== null || this.#runner !== null) return false
    const current = [this.#builtRevision, this.#activatingRevision, this.#activeRevision, this.#lastWorkingRevision]
      .map((revision) => this.#record(revision))
      .find((record) => record !== null && record.generation === this.#generation) ?? null
    if (current === null) return false
    const verified = this.#verifyPersistedInputFingerprint(current.inputFingerprint)
    if (verified !== null) {
      current.inputFingerprint = verified
      this.#inputFreshness = "verified"
      return false
    }
    this.#advanceGeneration(
      "Storybook build inputs no longer match verified evidence",
      Object.freeze({owner: "check", reason: "input-changed"}),
    )
    return true
  }

  subscribe(demand: StorybookPackageBuildDemand = Object.freeze({owner: "subscribe"})): () => void {
    this.#assertActive()
    const wasInactive = this.#subscribers === 0
    this.#subscribers += 1
    if (wasInactive) this.#requestCurrentGeneration(demand)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.#subscribers = Math.max(0, this.#subscribers - 1)
      if (this.#subscribers === 0) this.#cancelRebuildTimer()
    }
  }

  build(demand?: StorybookPackageBuildDemand): Promise<StorybookPackageSessionSnapshot> {
    return this.ensureBuilt(demand)
  }

  retryFailed(): boolean {
    this.#assertActive()
    if (this.#failedRevision === null || this.#runner !== null) return false
    this.#advanceGeneration(
      "Storybook explicit failed-build retry",
      Object.freeze({owner: "check", reason: "explicit-retry"}),
    )
    return true
  }

  async ensureBuilt(
    demand: StorybookPackageBuildDemand = Object.freeze({owner: "check"}),
  ): Promise<StorybookPackageSessionSnapshot> {
    this.#assertActive()
    while (!this.#disposed) {
      if (this.#resolutionError !== null) return this.snapshot()
      const target = this.#generation
      const existing = this.#revisionForGeneration(target)
      if (existing !== null && existing.status !== "failed") return this.snapshot()
      if (this.#completedGeneration >= target && this.#failedRevision !== null) return this.snapshot()
      this.#requestCurrentGeneration(demand)
      while (!this.#disposed && this.#completedGeneration < target) {
        const runner = this.#runner
        if (runner === null) break
        await runner
      }
      if (target === this.#generation) return this.snapshot()
    }
    return this.snapshot()
  }

  invalidate(path: string): boolean {
    this.#assertActive()
    const canonical = safeRealpath(path)
    const declared = declaredPaths(this.descriptor)
    const dependencies = new Set([...this.#revisions.values()].flatMap(({dependencyRealpaths}) => dependencyRealpaths))
    const inputWatchPaths = new Set(this.inputWatchPaths())
    if (!dependencies.has(canonical) && !declared.has(canonical) && !inputWatchPaths.has(canonical)) return false
    const hasSubscribers = this.#subscribers > 0
    this.#advanceGeneration(
      `Storybook dependency changed: ${canonical}`,
      Object.freeze({owner: "watch", reason: "input-changed"}),
      hasSubscribers,
    )
    this.#cancelRebuildTimer()
    if (!hasSubscribers) return true
    this.#rebuildTimer = setTimeout(() => {
      this.#rebuildTimer = null
      if (!this.#disposed && this.#subscribers > 0) this.#requestCurrentGeneration()
    }, this.#rebuildDelayMs)
    return true
  }

  beginActivation(input: Readonly<{
    revision: string
    viewId: string
    route: string
    timeoutMs?: number
  }>): StorybookPackageActivation {
    this.#assertActive()
    const revision = requiredText("activation revision", input.revision)
    const viewId = requiredText("activation viewId", input.viewId)
    const route = typeof input.route === "string" ? input.route : requiredText("activation route", input.route)
    const record = this.#revisions.get(revision)
    const restart = record?.status === "activating" && this.#activatingRevision === revision
    if (record === undefined || record.status !== "built" && !restart || record.generation !== this.#generation) {
      throw new Error(`Storybook revision is not the current built candidate: ${this.packageId}:${revision}`)
    }
    if (!record.graphSnapshot.routes.some(({path}) => path === route)) {
      throw new Error(`Unknown Storybook activation route: ${this.packageId}:${route}`)
    }
    this.#cancelActivation()
    const activationId = randomUUID()
    const timeoutMs = boundedDuration(
      input.timeoutMs ?? this.#activationTimeoutMs, 100, 60_000, "activation timeout",
    )
    const deadline = new Date(Date.now() + timeoutMs).toISOString()
    const timer = setTimeout(() => {
      if (this.#disposed) return
      this.failActivation({
        revision,
        activationId,
        diagnostic: storybookDiagnostic("timeout", "Storybook package activation timed out"),
      })
    }, timeoutMs)
    record.status = "activating"
    record.activation = {activationId, viewId, route, deadline, timer}
    this.#builtRevision = revision
    this.#activatingRevision = revision
    this.#buildState = "activating"
    this.#publish(Object.freeze({type: "package.activating", packageId: this.packageId, revision, activationId}))
    return Object.freeze({
      activationId,
      packageId: this.packageId,
      revision,
      viewId,
      route,
      packageGraphDigest: record.graphSnapshot.packageGraphDigest,
      deadline,
    })
  }

  acknowledgeActivation(input: Readonly<{
    revision: string
    activationId: string
    viewId: string
    route: string
    packageGraphDigest: string
    frameSequence: number
  }>): StorybookPackageSessionSnapshot {
    this.#assertActive()
    const record = this.#activationRecord(input.revision, input.activationId)
    const activation = record.activation!
    if (activation.viewId !== input.viewId || activation.route !== input.route ||
      record.graphSnapshot.packageGraphDigest !== input.packageGraphDigest) {
      throw new Error(`Storybook activation acknowledgement does not match its lease: ${this.packageId}`)
    }
    if (!Number.isSafeInteger(input.frameSequence) || input.frameSequence < 1) {
      throw new Error(`Storybook activation frame sequence is invalid: ${String(input.frameSequence)}`)
    }
    if (record.generation !== this.#generation || record.declarationDigest !== this.descriptor.declarationDigest) {
      throw new Error(`Storybook activation acknowledgement is stale: ${this.packageId}:${record.revision}`)
    }
    this.#saveApplied(record)
    clearTimeout(activation.timer)
    record.activation = null
    record.status = "working"
    record.diagnostics = Object.freeze([])
    this.#activatingRevision = null
    this.#builtRevision = null
    this.#activeRevision = record.revision
    this.#lastWorkingRevision = record.revision
    this.#failedRevision = null
    this.#diagnostics = Object.freeze([])
    this.#buildState = "active"
    this.#publish(Object.freeze({type: "package.updated", packageId: this.packageId, revision: record.revision}))
    this.#collectRevisions()
    return this.snapshot()
  }

  failActivation(input: Readonly<{
    revision: string
    activationId: string
    diagnostic: StorybookPackageDiagnostic | readonly StorybookPackageDiagnostic[]
  }>): StorybookPackageSessionSnapshot {
    this.#assertActive()
    const record = this.#activationRecord(input.revision, input.activationId)
    clearTimeout(record.activation!.timer)
    const diagnostics = normalizeDiagnostics(input.diagnostic)
    record.activation = null
    record.status = "failed"
    record.diagnostics = diagnostics
    this.#activatingRevision = null
    if (this.#builtRevision === record.revision) this.#builtRevision = null
    this.#failedRevision = record.revision
    this.#diagnostics = diagnostics
    this.#buildState = "failed"
    this.#publish(Object.freeze({
      type: "package.failed", packageId: this.packageId, revision: record.revision, diagnostics,
    }))
    this.#collectRevisions()
    return this.snapshot()
  }

  acquireRevisionLease(
    revision: string,
    leaseId: string = randomUUID(),
  ): Readonly<{leaseId: string, revision: string, release(): void}> {
    this.#assertActive()
    const record = this.#revisions.get(requiredText("lease revision", revision))
    if (record === undefined) throw new Error(`Unknown Storybook revision lease target: ${this.packageId}:${revision}`)
    const id = requiredText("lease id", leaseId)
    if (record.leases.has(id)) throw new Error(`Duplicate Storybook revision lease: ${id}`)
    record.leases.add(id)
    let released = false
    return Object.freeze({
      leaseId: id,
      revision,
      release: () => {
        if (released) return
        released = true
        record.leases.delete(id)
        this.#collectRevisions()
      },
    })
  }

  revisionGraphSnapshot(revision: string): StorybookPackageRevisionGraphSnapshot | null {
    return this.#revisions.get(revision)?.graphSnapshot ?? null
  }

  revisionDirectory(revision = this.#activeRevision ?? this.#lastWorkingRevision ?? this.#builtRevision): string | null {
    if (revision === null || !this.#revisions.has(revision)) return null
    const directory = this.#revisionDirectory(revision)
    return existsSync(directory) ? directory : null
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== null) return this.#disposePromise
    this.#disposed = true
    this.#cancelRebuildTimer()
    this.#cancelActivation()
    this.#runningBuild?.controller.abort(storybookAbortError("Storybook package detached"))
    this.#subscribers = 0
    this.#buildState = "disposed"
    this.#publish(Object.freeze({type: "package.detached", packageId: this.packageId}))
    const pending = this.#runner
    this.#disposePromise = (async () => {
      if (pending !== null) await pending.catch(() => {})
      this.#builtRevision = null
      this.#activatingRevision = null
      this.#activeRevision = null
      this.#lastWorkingRevision = null
      this.#collectRevisions()
      if (this.#ownsBuildScheduler) this.#buildScheduler.dispose()
    })()
    return this.#disposePromise
  }

  #startRunner(): void {
    if (this.#runner !== null || this.#disposed || this.#resolutionError !== null) return
    const runner = this.#runBuildQueue().finally(() => {
      if (this.#runner === runner) this.#runner = null
      if (!this.#disposed && this.#resolutionError === null && this.#requestedGeneration > this.#completedGeneration) this.#startRunner()
    })
    this.#runner = runner
  }

  #requestCurrentGeneration(demand?: StorybookPackageBuildDemand): void {
    if (demand !== undefined && this.#requestedGeneration < this.#generation) {
      const fallback = this.#defaultDemand(demand.owner)
      this.#generationDemands.set(this.#generation, normalizeDemand({...fallback, ...demand}, fallback.reason))
    }
    this.#requestedGeneration = Math.max(this.#requestedGeneration, this.#generation)
    this.#startRunner()
  }

  async #runBuildQueue(): Promise<void> {
    while (!this.#disposed && this.#resolutionError === null && this.#requestedGeneration > this.#completedGeneration) {
      const generation = this.#generation
      const descriptor = this.#descriptor
      const demand = this.#generationDemands.get(generation) ?? this.#defaultDemand("check")
      await this.#buildCandidate(descriptor, generation, demand)
      this.#completedGeneration = Math.max(this.#completedGeneration, generation)
      for (const key of this.#generationDemands.keys()) {
        if (key <= this.#completedGeneration) this.#generationDemands.delete(key)
      }
    }
  }

  async #buildCandidate(
    descriptor: StorybookPackageBuildDescriptor,
    generation: number,
    demand: NormalizedStorybookPackageBuildDemand,
  ): Promise<void> {
    const candidate = candidateRevision(descriptor, this.#builds)
    const stagingDirectory = `${this.#revisionDirectory(candidate)}.candidate-${randomUUID()}`
    const finalDirectory = this.#revisionDirectory(candidate)
    const controller = new AbortController()
    const operationId = randomUUID()
    this.#runningBuild = Object.freeze({generation, operationId, controller})
    this.#pendingOperationId = operationId
    this.#candidateRevision = candidate
    this.#buildState = "queued"
    this.#diagnostics = Object.freeze([])
    this.#builds += 1
    mkdirSync(stagingDirectory, {recursive: true})
    const queuedAtMs = Date.now()
    let startedAtMs: number | null = null
    let outcome: StorybookBuildOutcome = "failed"
    try {
      await this.#prepareBuild?.(controller.signal)
      controller.signal.throwIfAborted()
      if (this.#disposed || generation !== this.#generation || descriptor !== this.#descriptor) return
      const result = await this.#buildScheduler.run({
        operationId,
        packageId: this.packageId,
        owner: demand.owner,
        reason: demand.reason,
        generation,
        cache: demand.cache ?? Object.freeze({status: "miss", layer: "package"}),
      }, async (context) => {
        startedAtMs = Date.now()
        this.#buildState = "compiling"
        let worker: Readonly<{workerId: string, pid: number, release(): void}> | null = null
        const releaseWorker = (): void => {
          const current = worker as Readonly<{release(): void}> | null
          if (current === null) return
          current.release()
          worker = null
        }
        let built: StorybookPackageRevisionBuild
        try {
          built = await this.#buildRevision({
            descriptor,
            generation,
            candidateRevision: candidate,
            revisionUrl: revisionUrl(this.packageId, candidate),
            stagingDirectory,
            signal: controller.signal,
            compileTimeoutMs: this.#compileTimeoutMs,
            protocolTimeoutMs: this.#protocolTimeoutMs,
            onPhase: ({phase, state}) => {
              if (state === "started") context.setPhase(phase)
            },
            onWorkerLifecycle: (event) => {
              if (event.state === "started") {
                releaseWorker()
                worker = Object.freeze({
                  workerId: event.workerId,
                  pid: event.pid,
                  release: context.bindWorker({pid: event.pid}),
                })
              } else if (worker?.workerId === event.workerId && worker.pid === event.pid) {
                releaseWorker()
              }
            },
          })
        } finally {
          releaseWorker()
        }
        if (this.#disposed || controller.signal.aborted || generation !== this.#generation || descriptor !== this.#descriptor) {
          return built
        }
        context.setPhase("publish")
        validateBuildResult(built, stagingDirectory)
        if (built.inputFingerprint !== undefined) requiredInputFingerprint(built.inputFingerprint)
        if (existsSync(finalDirectory)) throw diagnosticError("publish", "Revision directory already exists", finalDirectory)
        mkdirSync(resolve(finalDirectory, ".."), {recursive: true})
        renameSync(stagingDirectory, finalDirectory)
        return built
      }, controller.signal)
      outcome = "completed"
      if (this.#disposed || controller.signal.aborted || generation !== this.#generation || descriptor !== this.#descriptor) return
      const record: RevisionRecord = {
        revision: candidate,
        generation,
        status: "built",
        declarationDigest: descriptor.declarationDigest,
        graphSnapshot: descriptor.graphSnapshot,
        moduleGraphRevision: result.moduleGraphRevision,
        dependencyRealpaths: Object.freeze(result.dependencyRealpaths.map(safeRealpath)),
        inputFingerprint: result.inputFingerprint === undefined
          ? null
          : requiredInputFingerprint(result.inputFingerprint),
        entryRelativePath: result.entryRelativePath,
        diagnostics: Object.freeze([]),
        createdAt: new Date().toISOString(),
        activation: null,
        leases: new Set(),
      }
      this.#revisions.set(candidate, record)
      this.#builtRevision = candidate
      this.#failedRevision = null
      this.#candidateRevision = null
      this.#diagnostics = Object.freeze([])
      this.#buildState = "built"
      this.#inputFreshness = record.inputFingerprint === null ? "unverified" : "verified"
      this.#publish(Object.freeze({
        type: "package.built",
        packageId: this.packageId,
        revision: candidate,
        graphDigest: descriptor.graphSnapshot.packageGraphDigest,
      }))
      this.#collectRevisions()
    } catch (error) {
      rmSync(stagingDirectory, {recursive: true, force: true})
      outcome = controller.signal.aborted ? "canceled" : isTimeoutBuildError(error) ? "timed-out" : "failed"
      if (this.#disposed || controller.signal.aborted || generation !== this.#generation || descriptor !== this.#descriptor) return
      const diagnostics = diagnosticsFromError(error)
      this.#candidateRevision = null
      this.#failedRevision = candidate
      this.#diagnostics = diagnostics
      this.#buildState = "failed"
      this.#publish(Object.freeze({
        type: "package.failed", packageId: this.packageId, revision: candidate, diagnostics,
      }))
    } finally {
      const completedAtMs = Date.now()
      const ownsRunningBuild = this.#runningBuild?.generation === generation && this.#runningBuild.operationId === operationId
      if (ownsRunningBuild) this.#runningBuild = null
      if (this.#pendingOperationId === operationId) this.#pendingOperationId = null
      this.#lastBuildReason = demand.reason
      this.#lastQueueDurationMs = Math.max(0, (startedAtMs ?? completedAtMs) - queuedAtMs)
      this.#lastExecutionDurationMs = startedAtMs === null ? 0 : Math.max(0, completedAtMs - startedAtMs)
      this.#lastBuildOutcome = outcome
      this.#cacheOutcome = demand.cache ?? Object.freeze({status: "miss", layer: "package"})
      if (this.#candidateRevision === candidate) this.#candidateRevision = null
      if (ownsRunningBuild && isPendingBuildState(this.#buildState)) {
        this.#restoreSettledBuildState()
      }
    }
  }

  #advanceGeneration(
    reason: string,
    demand: StorybookPackageBuildDemand,
    cancelRunningBuild = true,
  ): void {
    this.#generation += 1
    this.#generationDemands.set(this.#generation, normalizeDemand(demand, "input-changed"))
    this.#inputFreshness = "changed"
    this.#cacheOutcome = null
    if (cancelRunningBuild) this.#runningBuild?.controller.abort(storybookAbortError(reason))
    this.#cancelActivation()
    if (this.#builtRevision !== null && this.#record(this.#builtRevision)?.generation !== this.#generation) {
      this.#builtRevision = null
    }
  }

  #defaultDemand(owner: Exclude<StorybookBuildOwner, "shared">): NormalizedStorybookPackageBuildDemand {
    const pending = this.#generationDemands.get(this.#generation)
    const reason: StorybookBuildReason = this.#activeRevision !== null && this.#builds === 0
      ? "receipt-unverified"
      : pending?.reason ?? (this.#revisions.size === 0 ? "missing" : "input-changed")
    return Object.freeze({
      owner,
      reason,
      ...(pending?.cache === undefined ? {} : {cache: pending.cache}),
    })
  }

  #cancelRebuildTimer(): void {
    if (this.#rebuildTimer !== null) clearTimeout(this.#rebuildTimer)
    this.#rebuildTimer = null
  }

  #restoreSettledBuildState(): void {
    if (this.#disposed) return
    if (this.#activatingRevision !== null) {
      this.#buildState = "activating"
    } else if (this.#builtRevision !== null) {
      this.#buildState = "built"
    } else if (this.#failedRevision !== null &&
      this.#record(this.#failedRevision)?.generation === this.#generation) {
      this.#buildState = "failed"
    } else if (this.#activeRevision !== null) {
      this.#buildState = "active"
    } else {
      this.#buildState = "idle"
    }
  }

  #cancelActivation(): void {
    const record = this.#record(this.#activatingRevision)
    if (record?.activation !== null && record?.activation !== undefined) {
      clearTimeout(record.activation.timer)
      record.activation = null
      if (record.status === "activating") record.status = "built"
    }
    this.#activatingRevision = null
  }

  #activationRecord(revision: string, activationId: string): RevisionRecord {
    const record = this.#revisions.get(requiredText("activation revision", revision))
    if (record === undefined || record.status !== "activating" || record.activation === null ||
      record.activation.activationId !== requiredText("activation id", activationId)) {
      throw new Error(`Unknown or stale Storybook activation: ${this.packageId}:${revision}`)
    }
    return record
  }

  #revisionForGeneration(generation: number): RevisionRecord | null {
    return [...this.#revisions.values()].reverse().find((record) => record.generation === generation) ?? null
  }

  #record(revision: string | null): RevisionRecord | null {
    return revision === null ? null : this.#revisions.get(revision) ?? null
  }

  #collectRevisions(): void {
    const protectedRevisions = new Set<string>([this.#activeRevision, this.#lastWorkingRevision, this.#persistedAppliedRevision].filter((value): value is string => value !== null))
    if (!this.#disposed) {
      for (const revision of [
        this.#builtRevision, this.#activatingRevision, this.#activeRevision, this.#lastWorkingRevision,
      ]) {
        if (revision !== null) protectedRevisions.add(revision)
      }
    }
    for (const record of this.#revisions.values()) {
      if (record.leases.size > 0) protectedRevisions.add(record.revision)
    }
    if (!this.#disposed) {
      const recent = [...this.#revisions.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, this.#retainedRevisionLimit)
      for (const record of recent) protectedRevisions.add(record.revision)
    }
    for (const [revision] of this.#revisions) {
      if (protectedRevisions.has(revision)) continue
      this.#revisions.delete(revision)
      rmSync(this.#revisionDirectory(revision), {recursive: true, force: true})
    }
    if (this.#revisions.size === 0 && !existsSync(this.#appliedPath())) {
      rmSync(join(this.#artifactRoot, packageDirectoryName(this.packageId)), {recursive: true, force: true})
    }
  }

  #appliedPath(): string {
    return join(this.#artifactRoot, packageDirectoryName(this.packageId), "applied.json")
  }

  #saveApplied(record: RevisionRecord): void {
    const path = this.#appliedPath()
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify({
        version: record.inputFingerprint === null ? 1 : 2,
        packageId: this.packageId, packageRoot: this.descriptor.packageRoot,
        revision: record.revision, declarationDigest: record.declarationDigest,
        graphSnapshot: record.graphSnapshot, moduleGraphRevision: record.moduleGraphRevision,
        entryRelativePath: record.entryRelativePath, dependencyRealpaths: record.dependencyRealpaths,
        ...(record.inputFingerprint === null ? {} : {inputFingerprint: record.inputFingerprint}),
        createdAt: record.createdAt,
      }), {mode: 0o600, flag: "wx"})
      renameSync(temporary, path)
      this.#persistedAppliedRevision = record.revision
    } finally {
      rmSync(temporary, {force: true})
    }
  }

  #restoreApplied(): void {
    const path = this.#appliedPath()
    if (!existsSync(path)) return
    try {
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("Applied revision receipt must be an exact file")
      const value = JSON.parse(readFileSync(path, "utf8"))
      if ((value.version !== 1 && value.version !== 2) || value.packageId !== this.packageId || value.packageRoot !== this.descriptor.packageRoot ||
        typeof value.revision !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(value.revision)) throw new Error("Applied revision receipt has a different owner")
      const graphSnapshot = validateStorybookPackageRevisionGraphSnapshot(value.graphSnapshot, this.packageId)
      validateBuildResult(value, this.#revisionDirectory(value.revision))
      const persistedFingerprint = value.version === 2
        ? parseStorybookBuildInputFingerprint(value.inputFingerprint)
        : null
      const verifiedFingerprint = persistedFingerprint === null
        ? null
        : this.#verifyPersistedInputFingerprint(persistedFingerprint)
      const restoredGeneration = verifiedFingerprint === null ? 0 : this.#generation
      const record: RevisionRecord = {
        revision: value.revision, generation: restoredGeneration, status: "working",
        declarationDigest: graphSnapshot.declarationDigest, graphSnapshot,
        moduleGraphRevision: value.moduleGraphRevision, entryRelativePath: value.entryRelativePath,
        dependencyRealpaths: Object.freeze(value.dependencyRealpaths.map((path: unknown) => {
          const checked = requiredText("applied dependency path", path)
          if (!isAbsolute(checked)) throw new Error("Applied dependency path must be absolute")
          return checked
        })),
        inputFingerprint: verifiedFingerprint ?? persistedFingerprint,
        diagnostics: Object.freeze([]), createdAt: value.createdAt, activation: null, leases: new Set(),
      }
      this.#revisions.set(record.revision, record)
      this.#persistedAppliedRevision = record.revision
      this.#activeRevision = record.revision
      this.#lastWorkingRevision = record.revision
      this.#buildState = "active"
      this.#inputFreshness = verifiedFingerprint === null ? "unverified" : "verified"
      if (verifiedFingerprint !== null) {
        this.#completedGeneration = this.#generation
        this.#cacheOutcome = Object.freeze({status: "hit", layer: "receipt"})
      }
    } catch (error) {
      this.#diagnostics = Object.freeze([storybookDiagnostic("publish", error instanceof Error ? error.message : String(error), path)])
      this.#buildState = "failed"
    }
  }

  #verifyPersistedInputFingerprint(value: unknown): StorybookBuildInputFingerprint | null {
    const persisted = parseStorybookBuildInputFingerprint(value)
    if (this.#verifyInputFingerprint === null || persisted === null) return null
    try {
      const verified = this.#verifyInputFingerprint(persisted, this.#descriptor)
      return sameStorybookBuildInputFingerprint(persisted, verified)
        ? parseStorybookBuildInputFingerprint(verified)
        : null
    } catch {
      return null
    }
  }

  #revisionDirectory(revision: string): string {
    return join(this.#artifactRoot, packageDirectoryName(this.packageId), revision)
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error(`Storybook package session is disposed: ${this.packageId}`)
  }
}

export function revisionUrl(packageId: string, revision: string): string {
  return `/__storybook/revisions/${encodeURIComponent(packageId)}/${revision}/`
}

export function storybookDiagnostic(
  phase: StorybookPackageDiagnostic["phase"],
  message: string,
  path: string | null = null,
): StorybookPackageDiagnostic {
  return Object.freeze({phase, message, path})
}

export function storybookBuildError(
  diagnostic: StorybookPackageDiagnostic | readonly StorybookPackageDiagnostic[],
): Error {
  const diagnostics = Array.isArray(diagnostic) ? diagnostic : [diagnostic]
  const error = new Error(diagnostics.map(({message}) => message).join("\n"))
  Object.defineProperty(error, "storybookDiagnostics", {
    value: Object.freeze([...diagnostics]),
    enumerable: false,
  })
  return error
}

function normalizeDescriptor(value: StorybookPackageBuildDescriptor): StorybookPackageBuildDescriptor {
  if (value === null || typeof value !== "object") throw new Error("Storybook package descriptor must be an object")
  const packageId = requiredText("packageId", value.packageId)
  const packageRoot = realpathSync(value.packageRoot)
  const projectRoot = realpathSync(value.projectRoot)
  const sourcePath = safeRealpath(value.sourcePath)
  const declarationDigest = requiredText("declarationDigest", value.declarationDigest)
  const graphSnapshot = validateStorybookPackageRevisionGraphSnapshot(value.graphSnapshot, packageId)
  if (graphSnapshot.declarationDigest !== declarationDigest) {
    throw new Error(`Storybook package graph declaration digest mismatch: ${packageId}`)
  }
  const variants = Object.freeze([...value.variants].map((variant) => Object.freeze({
    route: requiredText("variant route", variant.route),
    module: normalizeModule(variant.module),
  })))
  const routes = new Set(variants.map(({route}) => route))
  if (routes.size !== variants.length) throw new Error(`Duplicate package variant route: ${packageId}`)
  if (JSON.stringify([...routes].sort()) !== JSON.stringify(graphSnapshot.loaders.map(({route}) => route).sort())) {
    throw new Error(`Storybook package loader table does not match graph snapshot: ${packageId}`)
  }
  const runtime = value.runtime === null ? null : normalizeModule(value.runtime)
  const widgetModules = Object.freeze([...value.widgetModules].map((widget) => Object.freeze({
    id: requiredText("widget module id", widget.id),
    module: normalizeModule(widget.module),
  })))
  if (new Set(widgetModules.map(({id}) => id)).size !== widgetModules.length) {
    throw new Error(`Duplicate package widget module id: ${packageId}`)
  }
  if (JSON.stringify(widgetModules.map(({id}) => id)) !==
    JSON.stringify(graphSnapshot.widgetLoaders.map(({id}) => id))) {
    throw new Error(`Storybook package widget loader table does not match graph snapshot: ${packageId}`)
  }
  for (const [index, widget] of widgetModules.entries()) {
    if (widget.module.export !== graphSnapshot.widgetLoaders[index]?.exportName) {
      throw new Error(`Storybook package widget loader export does not match graph snapshot: ${packageId}:${widget.id}`)
    }
  }
  const resourceFiles = Object.freeze((value.resourceFiles ?? []).map((file) => {
    const sourcePath = realpathSync(file.sourcePath)
    const sourceRoot = file.sourceRoot === undefined ? undefined : realpathSync(file.sourceRoot)
    if (sourceRoot !== undefined) {
      const local = relative(sourceRoot, sourcePath)
      if (local === "" || local.startsWith("..") || isAbsolute(local)) {
        throw new Error(`Storybook revision resource escaped its exact source root: ${sourcePath}`)
      }
    }
    const targetPath = file.targetPath
    if (typeof targetPath !== "string" || targetPath.length === 0 || targetPath.startsWith("/") ||
      targetPath.includes("\\") || targetPath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`Invalid Storybook revision resource target: ${String(targetPath)}`)
    }
    const contentDigest = file.contentDigest
    if (file.derivedContent !== undefined && (typeof file.derivedContent !== "string" || contentDigest === undefined || sourceRoot === undefined)) {
      throw new Error(`Derived revision resource requires attested source: ${targetPath}`)
    }
    if (contentDigest !== undefined && !/^[a-f0-9]{64}$/u.test(contentDigest)) {
      throw new Error(`Invalid Storybook revision resource content digest: ${targetPath}`)
    }
    return Object.freeze({
      sourcePath,
      ...(sourceRoot === undefined ? {} : {sourceRoot}),
      targetPath,
      ...(contentDigest === undefined ? {} : {contentDigest}),
      ...(file.derivedContent === undefined ? {} : {derivedContent: file.derivedContent}),
    })
  }))
  const watchPaths = Object.freeze((value.watchPaths ?? []).map((entry) => {
    if (!STORYBOOK_WATCH_CATEGORIES.includes(entry.category)) {
      throw new Error(`Unknown Storybook watch category: ${String(entry.category)}`)
    }
    return Object.freeze({path: safeRealpath(entry.path), category: entry.category})
  }))
  if (new Set(resourceFiles.map(({targetPath}) => targetPath)).size !== resourceFiles.length) {
    throw new Error(`Duplicate Storybook revision resource target: ${packageId}`)
  }
  const resourceByTarget = new Map(resourceFiles.map((file) => [file.targetPath, file] as const))
  for (const styleSheets of [
    graphSnapshot.workbenchAuthorStyleSheets,
    graphSnapshot.authorStyleSheets,
  ] as const) {
    for (const styleSheet of styleSheets) {
      const file = resourceByTarget.get(styleSheet.url)
      if (file === undefined || file.sourceRoot === undefined ||
        file.contentDigest !== styleSheet.contentDigest) {
        throw new Error(`Storybook author stylesheet resource does not match graph snapshot: ${styleSheet.specifier}`)
      }
    }
  }
  for (const file of resourceFiles) {
    if (file.targetPath.startsWith("author-style-sheets/") &&
      !graphSnapshot.authorStyleSheets.some(({url}) => url === file.targetPath)) {
      throw new Error(`Undeclared Storybook author stylesheet resource target: ${file.targetPath}`)
    }
    if (file.targetPath.startsWith("workbench-author-style-sheets/") &&
      !graphSnapshot.workbenchAuthorStyleSheets.some(({url}) => url === file.targetPath)) {
      throw new Error(`Undeclared Storybook Workbench author stylesheet resource target: ${file.targetPath}`)
    }
  }
  if (runtime === null && variants.length > 0) {
    throw new Error(`Executable variants require a package runtime: ${packageId}`)
  }
  return Object.freeze({
    packageId,
    packageRoot,
    projectRoot,
    sourcePath,
    declarationDigest,
    resourceFiles,
    watchPaths,
    graphSnapshot,
    runtime,
    variants,
    widgetModules,
    ...(value.watchedPaths === undefined
      ? {}
      : {watchedPaths: Object.freeze(value.watchedPaths.map(safeRealpath))}),
  })
}

function sameDescriptor(left: StorybookPackageBuildDescriptor, right: StorybookPackageBuildDescriptor): boolean {
  return left.declarationDigest === right.declarationDigest &&
    left.graphSnapshot.packageGraphDigest === right.graphSnapshot.packageGraphDigest &&
    left.packageRoot === right.packageRoot &&
    left.projectRoot === right.projectRoot &&
    left.sourcePath === right.sourcePath &&
    JSON.stringify(left.runtime) === JSON.stringify(right.runtime) &&
    JSON.stringify(left.variants) === JSON.stringify(right.variants) &&
    JSON.stringify(left.widgetModules) === JSON.stringify(right.widgetModules) &&
    JSON.stringify(left.resourceFiles ?? []) === JSON.stringify(right.resourceFiles ?? []) &&
    JSON.stringify(left.watchPaths ?? []) === JSON.stringify(right.watchPaths ?? []) &&
    JSON.stringify(left.watchedPaths ?? []) === JSON.stringify(right.watchedPaths ?? [])
}

function normalizeModule(value: StorybookPackageModule): StorybookPackageModule {
  return Object.freeze({path: realpathSync(value.path), export: requiredText("module export", value.export)})
}

function declaredPaths(descriptor: StorybookPackageBuildDescriptor): Set<string> {
  return new Set([
    descriptor.sourcePath,
    ...(descriptor.runtime === null ? [] : [descriptor.runtime.path]),
    ...descriptor.variants.map(({module}) => module.path),
    ...descriptor.widgetModules.map(({module}) => module.path),
    ...(descriptor.resourceFiles ?? []).map(({sourcePath}) => sourcePath),
    ...(descriptor.watchPaths ?? []).map(({path}) => path),
    ...(descriptor.watchedPaths ?? []),
  ])
}

function validateBuildResult(result: StorybookPackageRevisionBuild, stagingDirectory: string): void {
  if (result === null || typeof result !== "object") throw diagnosticError("compile", "Package build returned no result")
  requiredText("moduleGraphRevision", result.moduleGraphRevision)
  if (!Array.isArray(result.dependencyRealpaths)) {
    throw diagnosticError("compile", "Package build returned no dependency graph")
  }
  const entry = resolve(stagingDirectory, result.entryRelativePath)
  if (!entry.startsWith(`${resolve(stagingDirectory)}/`) || !existsSync(entry)) {
    throw diagnosticError("publish", "Package build entry is missing or escaped staging", entry)
  }
}

/** Отклоняет malformed evidence до атомарной публикации candidate directory. */
function requiredInputFingerprint(value: unknown): StorybookBuildInputFingerprint {
  const fingerprint = parseStorybookBuildInputFingerprint(value)
  if (fingerprint === null) throw diagnosticError("compile", "Package build returned an invalid input fingerprint")
  return fingerprint
}

function candidateRevision(descriptor: StorybookPackageBuildDescriptor, build: number): string {
  return createHash("sha256")
    .update(`${descriptor.packageId}\0${descriptor.declarationDigest}\0${build}\0${Date.now()}\0${randomUUID()}`)
    .digest("hex").slice(0, 24)
}

function packageDirectoryName(packageId: string): string {
  const visible = packageId.replace(/^@/u, "").replaceAll("/", "-").replace(/[^a-zA-Z0-9._-]/gu, "-")
  const digest = createHash("sha256").update(packageId).digest("hex").slice(0, 12)
  return `${visible}-${digest}`
}

function diagnosticsFromError(error: unknown): readonly StorybookPackageDiagnostic[] {
  if (error instanceof Error) {
    const value = (error as Error & {storybookDiagnostics?: unknown}).storybookDiagnostics
    if (Array.isArray(value) && value.every(isDiagnostic)) return Object.freeze([...value])
    return Object.freeze([storybookDiagnostic(error.name === "TimeoutError" ? "timeout" : "compile", error.message)])
  }
  return Object.freeze([storybookDiagnostic("compile", String(error))])
}

/** Классифицирует только diagnostics фазы timeout. */
function isTimeoutBuildError(error: unknown): boolean {
  return diagnosticsFromError(error).some(({phase}) => phase === "timeout")
}

/** Проверяет owner/reason package demand до передачи scheduler. */
function normalizeDemand(
  demand: StorybookPackageBuildDemand,
  fallbackReason: StorybookBuildReason,
): NormalizedStorybookPackageBuildDemand {
  if (demand === null || typeof demand !== "object") {
    throw new TypeError("Storybook package build demand is invalid")
  }
  if (!["open", "check", "watch", "subscribe", "startup-validation"].includes(demand.owner)) {
    throw new Error(`Unknown Storybook package build owner: ${String(demand.owner)}`)
  }
  const reason = demand.reason ?? fallbackReason
  if (!["missing", "input-changed", "receipt-unverified", "explicit-retry", "toolchain-changed"].includes(reason)) {
    throw new Error(`Unknown Storybook package build reason: ${String(demand.reason)}`)
  }
  return Object.freeze({...demand, reason})
}

/** Объединяет transitional states только для восстановления settled projection. */
function isPendingBuildState(state: StorybookPackageBuildState): boolean {
  return state === "queued" || state === "compiling" || state === "building"
}

function normalizeDiagnostics(
  value: StorybookPackageDiagnostic | readonly StorybookPackageDiagnostic[],
): readonly StorybookPackageDiagnostic[] {
  const diagnostics = Array.isArray(value) ? value : [value]
  if (!diagnostics.every(isDiagnostic) || diagnostics.length === 0) {
    throw new TypeError("Storybook activation diagnostics are invalid")
  }
  return Object.freeze([...diagnostics])
}

function revisionSnapshot(record: RevisionRecord): StorybookPackageRevisionSnapshot {
  return Object.freeze({
    revision: record.revision,
    generation: record.generation,
    status: record.status,
    declarationDigest: record.declarationDigest,
    packageGraphDigest: record.graphSnapshot.packageGraphDigest,
    moduleGraphRevision: record.moduleGraphRevision,
    entryRelativePath: record.entryRelativePath,
    dependencyRealpaths: record.dependencyRealpaths,
    diagnostics: record.diagnostics,
    createdAt: record.createdAt,
    leases: record.leases.size,
  })
}

function diagnosticError(
  phase: StorybookPackageDiagnostic["phase"], message: string, path: string | null = null,
): Error {
  return storybookBuildError(storybookDiagnostic(phase, message, path))
}

function isDiagnostic(value: unknown): value is StorybookPackageDiagnostic {
  if (value === null || typeof value !== "object") return false
  const diagnostic = value as StorybookPackageDiagnostic
  return ["resolve", "validate", "compile", "link", "protocol", "publish", "watch", "activation", "timeout"]
    .includes(diagnostic.phase) && typeof diagnostic.message === "string" &&
    (diagnostic.path === null || typeof diagnostic.path === "string")
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function requiredText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Storybook package ${label} must be non-empty text`)
  }
  return value
}

function boundedDuration(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid Storybook package ${label}: ${String(value)}`)
  }
  return value
}
