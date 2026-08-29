import {createHash, randomUUID} from "node:crypto"
import {existsSync, mkdirSync, realpathSync, renameSync, rmSync} from "node:fs"
import {basename, join, resolve} from "node:path"

export type StorybookPackageModule = Readonly<{
  path: string
  export: string
}>

export type StorybookPackageVariantModule = Readonly<{
  route: string
  module: StorybookPackageModule
}>

export type StorybookPackageBuildDescriptor = Readonly<{
  packageId: string
  packageRoot: string
  projectRoot: string
  manifestPath: string
  declarationDigest: string
  runtime: StorybookPackageModule | null
  variants: readonly StorybookPackageVariantModule[]
  watchedPaths?: readonly string[]
}>

export type StorybookPackageDiagnostic = Readonly<{
  phase: "resolve" | "validate" | "compile" | "link" | "protocol" | "publish" | "watch"
  message: string
  path: string | null
}>

export type StorybookPackageBuildState = "idle" | "building" | "ready" | "failed" | "disposed"

export type StorybookPackageSessionSnapshot = Readonly<{
  packageId: string
  declarationDigest: string
  moduleGraphRevision: string | null
  candidateRevision: string | null
  activeRevision: string | null
  lastGoodRevision: string | null
  entryRelativePath: string | null
  diagnostics: readonly StorybookPackageDiagnostic[]
  dependencyRealpaths: readonly string[]
  subscribers: number
  buildState: StorybookPackageBuildState
  builds: number
}>

export type StorybookPackageEvent = Readonly<{
  type: "package.updated"
  packageId: string
  revision: string
}> | Readonly<{
  type: "package.failed"
  packageId: string
  diagnostics: readonly StorybookPackageDiagnostic[]
}> | Readonly<{
  type: "package.detached"
  packageId: string
}>

export type StorybookPackageRevisionBuild = Readonly<{
  moduleGraphRevision: string
  dependencyRealpaths: readonly string[]
  entryRelativePath: string
}>

export type StorybookPackageRevisionBuilder = (
  input: Readonly<{
    descriptor: StorybookPackageBuildDescriptor
    candidateRevision: string
    revisionUrl: string
    stagingDirectory: string
  }>,
) => Promise<StorybookPackageRevisionBuild>

export type StorybookPackageSessionOptions = Readonly<{
  artifactRoot: string
  buildRevision: StorybookPackageRevisionBuilder
  publish?(event: StorybookPackageEvent): void
  rebuildDelayMs?: number
}>

/** One independently buildable, publishable and diagnosable package boundary. */
export class StorybookPackageSession {
  #descriptor: StorybookPackageBuildDescriptor
  readonly #artifactRoot: string
  readonly #buildRevision: StorybookPackageRevisionBuilder
  readonly #publish: (event: StorybookPackageEvent) => void
  readonly #rebuildDelayMs: number
  #moduleGraphRevision: string | null = null
  #candidateRevision: string | null = null
  #activeRevision: string | null = null
  #lastGoodRevision: string | null = null
  #entryRelativePath: string | null = null
  #diagnostics: readonly StorybookPackageDiagnostic[] = Object.freeze([])
  #dependencyRealpaths = new Set<string>()
  #publishedRevisions = new Set<string>()
  #buildState: StorybookPackageBuildState = "idle"
  #builds = 0
  #subscribers = 0
  #building: Promise<StorybookPackageSessionSnapshot> | null = null
  #queued = false
  #rebuildTimer: ReturnType<typeof setTimeout> | null = null
  #disposed = false

  constructor(
    descriptor: StorybookPackageBuildDescriptor,
    options: StorybookPackageSessionOptions,
  ) {
    this.#descriptor = normalizeDescriptor(descriptor)
    this.#artifactRoot = resolve(options.artifactRoot)
    this.#buildRevision = options.buildRevision
    this.#publish = options.publish ?? (() => {})
    this.#rebuildDelayMs = options.rebuildDelayMs ?? 40
    if (!Number.isFinite(this.#rebuildDelayMs) || this.#rebuildDelayMs < 0) {
      throw new Error(`Invalid Storybook package rebuild delay: ${this.#rebuildDelayMs}`)
    }
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
    const hadCandidate = this.#building !== null
    const hadRevision = this.#activeRevision !== null || this.#buildState === "failed"
    this.#descriptor = next
    if (hadCandidate) this.#queued = true
    else if (hadRevision) void this.build()
    return true
  }

  snapshot(): StorybookPackageSessionSnapshot {
    return Object.freeze({
      packageId: this.descriptor.packageId,
      declarationDigest: this.descriptor.declarationDigest,
      moduleGraphRevision: this.#moduleGraphRevision,
      candidateRevision: this.#candidateRevision,
      activeRevision: this.#activeRevision,
      lastGoodRevision: this.#lastGoodRevision,
      entryRelativePath: this.#entryRelativePath,
      diagnostics: this.#diagnostics,
      dependencyRealpaths: Object.freeze([...this.#dependencyRealpaths].sort()),
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
    this.#assertActive()
    if (this.#building !== null) {
      this.#queued = true
      return this.#followBuild(this.#building)
    }
    const promise = this.#buildCandidate()
    this.#building = promise
    return this.#followBuild(promise)
  }

  async #followBuild(
    promise: Promise<StorybookPackageSessionSnapshot>,
  ): Promise<StorybookPackageSessionSnapshot> {
    const result = await promise
    if (this.#building !== promise) {
      return this.#building === null ? this.snapshot() : this.#followBuild(this.#building)
    }
    this.#building = null
    if (!this.#queued || this.#disposed) return result
    this.#queued = false
    const next = this.#buildCandidate()
    this.#building = next
    return this.#followBuild(next)
  }

  invalidate(path: string): boolean {
    this.#assertActive()
    const canonical = safeRealpath(path)
    const declared = declaredPaths(this.descriptor)
    if (!this.#dependencyRealpaths.has(canonical) && !declared.has(canonical)) return false
    if (this.#rebuildTimer !== null) clearTimeout(this.#rebuildTimer)
    this.#rebuildTimer = setTimeout(() => {
      this.#rebuildTimer = null
      if (!this.#disposed) void this.build()
    }, this.#rebuildDelayMs)
    return true
  }

  revisionDirectory(revision = this.#activeRevision): string | null {
    if (revision === null) return null
    if (!this.#publishedRevisions.has(revision)) return null
    const directory = this.#revisionDirectory(revision)
    return existsSync(directory) ? directory : null
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#rebuildTimer !== null) clearTimeout(this.#rebuildTimer)
    this.#rebuildTimer = null
    this.#queued = false
    this.#subscribers = 0
    this.#buildState = "disposed"
    this.#publish(Object.freeze({type: "package.detached", packageId: this.packageId}))
  }

  async #buildCandidate(): Promise<StorybookPackageSessionSnapshot> {
    const descriptor = this.#descriptor
    const candidate = candidateRevision(descriptor, this.#builds)
    const stagingDirectory = `${this.#revisionDirectory(candidate)}.candidate-${randomUUID()}`
    const finalDirectory = this.#revisionDirectory(candidate)
    this.#candidateRevision = candidate
    this.#buildState = "building"
    this.#diagnostics = Object.freeze([])
    this.#builds += 1
    mkdirSync(stagingDirectory, {recursive: true})
    try {
      const result = await this.#buildRevision({
        descriptor,
        candidateRevision: candidate,
        revisionUrl: revisionUrl(this.packageId, candidate),
        stagingDirectory,
      })
      if (this.#disposed || descriptor !== this.#descriptor) {
        rmSync(stagingDirectory, {recursive: true, force: true})
        if (!this.#disposed) this.#queued = true
        return this.snapshot()
      }
      validateBuildResult(result, stagingDirectory)
      if (existsSync(finalDirectory)) throw diagnosticError("publish", "Revision directory already exists", finalDirectory)
      mkdirSync(resolve(finalDirectory, ".."), {recursive: true})
      renameSync(stagingDirectory, finalDirectory)
      this.#moduleGraphRevision = result.moduleGraphRevision
      this.#dependencyRealpaths = new Set(result.dependencyRealpaths.map(safeRealpath))
      this.#activeRevision = candidate
      this.#lastGoodRevision = candidate
      this.#publishedRevisions.add(candidate)
      this.#entryRelativePath = result.entryRelativePath
      this.#candidateRevision = null
      this.#diagnostics = Object.freeze([])
      this.#buildState = "ready"
      this.#publish(Object.freeze({
        type: "package.updated",
        packageId: this.packageId,
        revision: candidate,
      }))
    } catch (error) {
      rmSync(stagingDirectory, {recursive: true, force: true})
      if (this.#disposed) return this.snapshot()
      if (descriptor !== this.#descriptor) {
        this.#queued = true
        return this.snapshot()
      }
      const diagnostics = diagnosticsFromError(error)
      this.#candidateRevision = null
      this.#diagnostics = diagnostics
      this.#buildState = "failed"
      this.#publish(Object.freeze({
        type: "package.failed",
        packageId: this.packageId,
        diagnostics,
      }))
    }
    return this.snapshot()
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
  const variants = Object.freeze([...value.variants].map((variant) => Object.freeze({
    route: requiredText("variant route", variant.route),
    module: normalizeModule(variant.module),
  })))
  const routes = new Set(variants.map(({route}) => route))
  if (routes.size !== variants.length) throw new Error(`Duplicate package variant route: ${packageId}`)
  const runtime = value.runtime === null ? null : normalizeModule(value.runtime)
  if (runtime === null && variants.length > 0) {
    throw new Error(`Executable variants require a package runtime: ${packageId}`)
  }
  return Object.freeze({
    packageId,
    packageRoot,
    projectRoot,
    manifestPath,
    declarationDigest,
    runtime,
    variants,
    ...(value.watchedPaths === undefined
      ? {}
      : {watchedPaths: Object.freeze(value.watchedPaths.map(safeRealpath))}),
  })
}

function sameDescriptor(
  left: StorybookPackageBuildDescriptor,
  right: StorybookPackageBuildDescriptor,
): boolean {
  return left.declarationDigest === right.declarationDigest &&
    left.packageRoot === right.packageRoot &&
    left.projectRoot === right.projectRoot &&
    left.manifestPath === right.manifestPath &&
    JSON.stringify(left.runtime) === JSON.stringify(right.runtime) &&
    JSON.stringify(left.variants) === JSON.stringify(right.variants) &&
    JSON.stringify(left.watchedPaths ?? []) === JSON.stringify(right.watchedPaths ?? [])
}

function normalizeModule(value: StorybookPackageModule): StorybookPackageModule {
  return Object.freeze({
    path: realpathSync(value.path),
    export: requiredText("module export", value.export),
  })
}

function declaredPaths(descriptor: StorybookPackageBuildDescriptor): Set<string> {
  return new Set([
    descriptor.manifestPath,
    ...(descriptor.runtime === null ? [] : [descriptor.runtime.path]),
    ...descriptor.variants.map(({module}) => module.path),
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
    .digest("hex")
    .slice(0, 24)
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
    return Object.freeze([storybookDiagnostic("compile", error.message)])
  }
  return Object.freeze([storybookDiagnostic("compile", String(error))])
}

function diagnosticError(
  phase: StorybookPackageDiagnostic["phase"],
  message: string,
  path: string | null = null,
): Error {
  return storybookBuildError(storybookDiagnostic(phase, message, path))
}

function isDiagnostic(value: unknown): value is StorybookPackageDiagnostic {
  if (value === null || typeof value !== "object") return false
  const diagnostic = value as StorybookPackageDiagnostic
  return ["resolve", "validate", "compile", "link", "protocol", "publish", "watch"].includes(diagnostic.phase) &&
    typeof diagnostic.message === "string" &&
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
