import {createHash, randomUUID} from "node:crypto"
import {existsSync, mkdirSync, realpathSync, renameSync, rmSync} from "node:fs"
import {isAbsolute, join, relative, resolve} from "node:path"
import {StorybookBuildSemaphore, storybookAbortError} from "./build-semaphore.ts"
import {
  STORYBOOK_WATCH_CATEGORIES,
  type StorybookCategorizedWatchPath,
} from "./dependency-watch.ts"
import {
  validateStorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionGraphSnapshot,
} from "./package-revision.ts"
import {STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS} from "./timing.ts"

export type StorybookPackageModule = Readonly<{path: string, export: string}>
export type StorybookPackageVariantModule = Readonly<{route: string, module: StorybookPackageModule}>
export type StorybookPackageWidgetModule = Readonly<{id: string, module: StorybookPackageModule}>
export type StorybookPackageRevisionResourceFile = Readonly<{
  sourcePath: string
  sourceRoot?: string
  targetPath: string
  contentDigest?: string
}>

export type StorybookPackageBuildDescriptor = Readonly<{
  packageId: string
  packageRoot: string
  projectRoot: string
  manifestPath: string
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
  | "idle" | "building" | "built" | "activating" | "active" | "failed" | "disposed" | "ready"
export type StorybookPackageRevisionStatus = "built" | "activating" | "working" | "failed"

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
}>

export type StorybookPackageRevisionBuilder = (input: Readonly<{
  descriptor: StorybookPackageBuildDescriptor
  generation: number
  candidateRevision: string
  revisionUrl: string
  stagingDirectory: string
  signal: AbortSignal
  compileTimeoutMs: number
  protocolTimeoutMs: number
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
  publish?(event: StorybookPackageEvent): void
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

type RunningBuild = Readonly<{generation: number, controller: AbortController}>

const DEFAULT_PROTOCOL_TIMEOUT_MS = 10_000
const DEFAULT_ACTIVATION_TIMEOUT_MS = 15_000
const DEFAULT_RETAINED_REVISION_LIMIT = 3

/** One independently queued, activated and diagnosable package boundary. */
export class StorybookPackageSession {
  #descriptor: StorybookPackageBuildDescriptor
  readonly #artifactRoot: string
  readonly #buildRevision: StorybookPackageRevisionBuilder
  readonly #publish: (event: StorybookPackageEvent) => void
  readonly #buildSemaphore: StorybookBuildSemaphore
  readonly #ownsBuildSemaphore: boolean
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
  #failedRevision: string | null = null
  #diagnostics: readonly StorybookPackageDiagnostic[] = Object.freeze([])
  #buildState: StorybookPackageBuildState = "idle"
  #builds = 0
  #subscribers = 0
  #runner: Promise<void> | null = null
  #runningBuild: RunningBuild | null = null
  #rebuildTimer: ReturnType<typeof setTimeout> | null = null
  #disposed = false
  #disposePromise: Promise<void> | null = null

  constructor(descriptor: StorybookPackageBuildDescriptor, options: StorybookPackageSessionOptions) {
    this.#descriptor = normalizeDescriptor(descriptor)
    this.#artifactRoot = resolve(options.artifactRoot)
    this.#buildRevision = options.buildRevision
    this.#publish = options.publish ?? (() => {})
    this.#ownsBuildSemaphore = options.buildSemaphore === undefined
    this.#buildSemaphore = options.buildSemaphore ?? new StorybookBuildSemaphore(1)
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
  }

  get packageId(): string {
    return this.#descriptor.packageId
  }

  get descriptor(): StorybookPackageBuildDescriptor {
    return this.#descriptor
  }

  reconfigure(descriptor: StorybookPackageBuildDescriptor): boolean {
    this.#assertActive()
    const next = normalizeDescriptor(descriptor)
    if (next.packageId !== this.packageId) {
      throw new Error(`Cannot reconfigure Storybook package identity ${this.packageId} as ${next.packageId}`)
    }
    if (sameDescriptor(this.#descriptor, next)) return false
    const shouldBuild = this.#builds > 0 || this.#runner !== null || this.#failedRevision !== null
    this.#descriptor = next
    this.#advanceGeneration("Storybook package reconfigured")
    if (shouldBuild) void this.ensureBuilt()
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
      diagnostics: this.#diagnostics,
      dependencyRealpaths: selected?.dependencyRealpaths ?? Object.freeze([]),
      revisions: Object.freeze([...this.#revisions.values()].map(revisionSnapshot)),
      subscribers: this.#subscribers,
      buildState: this.#buildState,
      builds: this.#builds,
    })
  }

  subscribe(): () => void {
    this.#assertActive()
    this.#subscribers += 1
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.#subscribers = Math.max(0, this.#subscribers - 1)
    }
  }

  build(): Promise<StorybookPackageSessionSnapshot> {
    return this.ensureBuilt()
  }

  retryFailed(): boolean {
    this.#assertActive()
    if (this.#failedRevision === null || this.#runner !== null) return false
    this.#advanceGeneration("Storybook explicit failed-build retry")
    return true
  }

  async ensureBuilt(): Promise<StorybookPackageSessionSnapshot> {
    this.#assertActive()
    const target = this.#generation
    const existing = this.#revisionForGeneration(target)
    if (existing !== null && existing.status !== "failed") return this.snapshot()
    if (this.#completedGeneration >= target && this.#failedRevision !== null) return this.snapshot()
    this.#requestedGeneration = Math.max(this.#requestedGeneration, target)
    this.#startRunner()
    while (!this.#disposed && this.#completedGeneration < target) {
      const runner = this.#runner
      if (runner === null) break
      await runner
    }
    return this.snapshot()
  }

  invalidate(path: string): boolean {
    this.#assertActive()
    const canonical = safeRealpath(path)
    const declared = declaredPaths(this.descriptor)
    const dependencies = new Set([...this.#revisions.values()].flatMap(({dependencyRealpaths}) => dependencyRealpaths))
    if (!dependencies.has(canonical) && !declared.has(canonical)) return false
    this.#advanceGeneration(`Storybook dependency changed: ${canonical}`)
    if (this.#rebuildTimer !== null) clearTimeout(this.#rebuildTimer)
    this.#rebuildTimer = setTimeout(() => {
      this.#rebuildTimer = null
      if (!this.#disposed) void this.ensureBuilt()
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
    if (this.#rebuildTimer !== null) clearTimeout(this.#rebuildTimer)
    this.#rebuildTimer = null
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
      if (this.#ownsBuildSemaphore) this.#buildSemaphore.dispose()
    })()
    return this.#disposePromise
  }

  #startRunner(): void {
    if (this.#runner !== null || this.#disposed) return
    const runner = this.#runBuildQueue().finally(() => {
      if (this.#runner === runner) this.#runner = null
      if (!this.#disposed && this.#requestedGeneration > this.#completedGeneration) this.#startRunner()
    })
    this.#runner = runner
  }

  async #runBuildQueue(): Promise<void> {
    while (!this.#disposed && this.#requestedGeneration > this.#completedGeneration) {
      const generation = this.#generation
      const descriptor = this.#descriptor
      await this.#buildCandidate(descriptor, generation)
      this.#completedGeneration = Math.max(this.#completedGeneration, generation)
    }
  }

  async #buildCandidate(descriptor: StorybookPackageBuildDescriptor, generation: number): Promise<void> {
    const candidate = candidateRevision(descriptor, this.#builds)
    const stagingDirectory = `${this.#revisionDirectory(candidate)}.candidate-${randomUUID()}`
    const finalDirectory = this.#revisionDirectory(candidate)
    const controller = new AbortController()
    this.#runningBuild = Object.freeze({generation, controller})
    this.#candidateRevision = candidate
    this.#buildState = "building"
    this.#diagnostics = Object.freeze([])
    this.#builds += 1
    mkdirSync(stagingDirectory, {recursive: true})
    try {
      const result = await this.#buildSemaphore.run(() => this.#buildRevision({
        descriptor,
        generation,
        candidateRevision: candidate,
        revisionUrl: revisionUrl(this.packageId, candidate),
        stagingDirectory,
        signal: controller.signal,
        compileTimeoutMs: this.#compileTimeoutMs,
        protocolTimeoutMs: this.#protocolTimeoutMs,
      }), controller.signal)
      if (this.#disposed || controller.signal.aborted || generation !== this.#generation || descriptor !== this.#descriptor) {
        rmSync(stagingDirectory, {recursive: true, force: true})
        return
      }
      validateBuildResult(result, stagingDirectory)
      if (existsSync(finalDirectory)) throw diagnosticError("publish", "Revision directory already exists", finalDirectory)
      mkdirSync(resolve(finalDirectory, ".."), {recursive: true})
      renameSync(stagingDirectory, finalDirectory)
      const record: RevisionRecord = {
        revision: candidate,
        generation,
        status: "built",
        declarationDigest: descriptor.declarationDigest,
        graphSnapshot: descriptor.graphSnapshot,
        moduleGraphRevision: result.moduleGraphRevision,
        dependencyRealpaths: Object.freeze(result.dependencyRealpaths.map(safeRealpath)),
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
      this.#publish(Object.freeze({
        type: "package.built",
        packageId: this.packageId,
        revision: candidate,
        graphDigest: descriptor.graphSnapshot.packageGraphDigest,
      }))
      this.#collectRevisions()
    } catch (error) {
      rmSync(stagingDirectory, {recursive: true, force: true})
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
      if (this.#runningBuild?.generation === generation) this.#runningBuild = null
      if (this.#candidateRevision === candidate) this.#candidateRevision = null
    }
  }

  #advanceGeneration(reason: string): void {
    this.#generation += 1
    this.#requestedGeneration = Math.max(this.#requestedGeneration, this.#generation)
    this.#runningBuild?.controller.abort(storybookAbortError(reason))
    this.#cancelActivation()
    if (this.#builtRevision !== null && this.#record(this.#builtRevision)?.generation !== this.#generation) {
      this.#builtRevision = null
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
    const protectedRevisions = new Set<string>()
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
    if (this.#revisions.size === 0) {
      rmSync(join(this.#artifactRoot, packageDirectoryName(this.packageId)), {recursive: true, force: true})
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
  const manifestPath = realpathSync(value.manifestPath)
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
    if (contentDigest !== undefined && !/^[a-f0-9]{64}$/u.test(contentDigest)) {
      throw new Error(`Invalid Storybook revision resource content digest: ${targetPath}`)
    }
    return Object.freeze({
      sourcePath,
      ...(sourceRoot === undefined ? {} : {sourceRoot}),
      targetPath,
      ...(contentDigest === undefined ? {} : {contentDigest}),
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
    manifestPath,
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
    left.manifestPath === right.manifestPath &&
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
    descriptor.manifestPath,
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
