import {realpathSync} from "node:fs"
import {resolve} from "node:path"
import {StorybookBuildSemaphore} from "./build-semaphore.ts"
import {StorybookDependencyWatchCoordinator} from "./dependency-watch.ts"
import {
  StorybookPackageSession,
  storybookDiagnostic,
  type StorybookPackageBuildDescriptor,
  type StorybookPackageEvent,
  type StorybookPackageRevisionBuilder,
  type StorybookPackageSessionSnapshot,
} from "./package-session.ts"

export type ExternalStorybookSessionManagerOptions = Readonly<{
  artifactRoot: string
  buildRevision: StorybookPackageRevisionBuilder
  publish?(event: StorybookPackageEvent): void
  watch?: StorybookDependencyWatchCoordinator
  buildSemaphore?: StorybookBuildSemaphore
  buildConcurrency?: number
  rebuildDelayMs?: number
  compileTimeoutMs?: number
  protocolTimeoutMs?: number
  activationTimeoutMs?: number
  retainedRevisionLimit?: number
}>

/** Owns PackageSessions as a derived runtime view of the canonical graph. */
export class ExternalStorybookSessionManager {
  readonly #artifactRoot: string
  readonly #buildRevision: StorybookPackageRevisionBuilder
  readonly #publish: (event: StorybookPackageEvent) => void
  readonly #watch: StorybookDependencyWatchCoordinator
  readonly #ownsWatch: boolean
  readonly #buildSemaphore: StorybookBuildSemaphore
  readonly #ownsBuildSemaphore: boolean
  readonly #rebuildDelayMs: number | undefined
  readonly #compileTimeoutMs: number | undefined
  readonly #protocolTimeoutMs: number | undefined
  readonly #activationTimeoutMs: number | undefined
  readonly #retainedRevisionLimit: number | undefined
  readonly #sessions = new Map<string, StorybookPackageSession>()
  #disposed = false
  #disposePromise: Promise<void> | null = null

  constructor(options: ExternalStorybookSessionManagerOptions) {
    this.#artifactRoot = resolve(options.artifactRoot)
    this.#buildRevision = options.buildRevision
    this.#publish = options.publish ?? (() => {})
    this.#rebuildDelayMs = options.rebuildDelayMs
    this.#compileTimeoutMs = options.compileTimeoutMs
    this.#protocolTimeoutMs = options.protocolTimeoutMs
    this.#activationTimeoutMs = options.activationTimeoutMs
    this.#retainedRevisionLimit = options.retainedRevisionLimit
    this.#ownsBuildSemaphore = options.buildSemaphore === undefined
    this.#buildSemaphore = options.buildSemaphore ?? new StorybookBuildSemaphore(options.buildConcurrency)
    this.#ownsWatch = options.watch === undefined
    this.#watch = options.watch ?? new StorybookDependencyWatchCoordinator({
      onError: ({packageId, path, error}) => this.#publish(Object.freeze({
        type: "package.failed",
        packageId,
        diagnostics: Object.freeze([storybookDiagnostic(
          "watch",
          error instanceof Error ? error.message : String(error),
          path,
        )]),
      })),
    })
  }

  sync(descriptors: readonly StorybookPackageBuildDescriptor[]): void {
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
      this.#watch.remove(packageId)
      void session.dispose()
      this.#sessions.delete(packageId)
    }
    for (const descriptor of descriptors) {
      const current = this.#sessions.get(descriptor.packageId)
      if (current === undefined) {
        const session = new StorybookPackageSession(descriptor, {
          artifactRoot: this.#artifactRoot,
          buildRevision: this.#buildRevision,
          buildSemaphore: this.#buildSemaphore,
          ...(this.#rebuildDelayMs === undefined ? {} : {rebuildDelayMs: this.#rebuildDelayMs}),
          ...(this.#compileTimeoutMs === undefined ? {} : {compileTimeoutMs: this.#compileTimeoutMs}),
          ...(this.#protocolTimeoutMs === undefined ? {} : {protocolTimeoutMs: this.#protocolTimeoutMs}),
          ...(this.#activationTimeoutMs === undefined ? {} : {activationTimeoutMs: this.#activationTimeoutMs}),
          ...(this.#retainedRevisionLimit === undefined ? {} : {retainedRevisionLimit: this.#retainedRevisionLimit}),
          publish: (event) => this.#onSessionEvent(event),
        })
        this.#sessions.set(descriptor.packageId, session)
        this.#replaceWatch(session)
      } else if (current.reconfigure(descriptor)) {
        this.#replaceWatch(current)
      }
    }
  }

  session(packageId: string): StorybookPackageSession {
    this.#assertActive()
    const session = this.#sessions.get(packageId)
    if (session === undefined) throw new Error(`Unknown Storybook PackageSession: ${packageId}`)
    return session
  }

  async ensure(packageId: string): Promise<StorybookPackageSessionSnapshot> {
    const session = this.session(packageId)
    const current = session.snapshot()
    const active = current.revisions?.find(({revision}) => revision === current.activeRevision)
    if ((current.builtRevision !== null && current.builtRevision !== undefined) ||
      current.activatingRevision !== null && current.activatingRevision !== undefined ||
      active !== undefined && active.generation === current.generation) return current
    return session.ensureBuilt()
  }

  retryFailed(packageId: string): boolean {
    return this.session(packageId).retryFailed()
  }

  snapshots(): readonly StorybookPackageSessionSnapshot[] {
    this.#assertActive()
    return Object.freeze([...this.#sessions.values()].map((session) => session.snapshot()))
  }

  notifyDependency(path: string): number {
    this.#assertActive()
    return this.#watch.notify(path)
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== null) return this.#disposePromise
    this.#disposed = true
    const sessions = [...this.#sessions.values()]
    const pending = sessions.map((session) => session.dispose())
    this.#sessions.clear()
    if (this.#ownsWatch) this.#watch.dispose()
    this.#disposePromise = Promise.all(pending).then(() => {
      if (this.#ownsBuildSemaphore) this.#buildSemaphore.dispose()
    })
    return this.#disposePromise
  }

  #onSessionEvent(event: StorybookPackageEvent): void {
    const session = this.#sessions.get(event.packageId)
    if ((event.type === "package.built" || event.type === "package.updated") && session !== undefined) {
      try {
        this.#replaceWatch(session)
      } catch (error) {
        console.error(`Storybook dependency watch projection failed for ${event.packageId}`, error)
      }
    }
    try {
      this.#publish(event)
    } catch (error) {
      console.error(`Storybook package event publication failed for ${event.packageId}`, error)
    }
  }

  #replaceWatch(session: StorybookPackageSession): void {
    const descriptor = session.descriptor
    const paths = [
      ...(descriptor.runtime === null ? [] : [{path: descriptor.runtime.path, category: "code" as const}]),
      ...descriptor.variants.map(({module}) => ({path: module.path, category: "code" as const})),
      ...(descriptor.watchPaths ?? (descriptor.watchedPaths ?? []).map((path) => ({path, category: "code" as const}))),
      ...session.snapshot().dependencyRealpaths.map((path) => ({path, category: "code" as const})),
    ]
    const categorized = uniqueCategorizedPaths(paths)
    const onEvent = (event: Readonly<{
      path: string
      categories: readonly ("declaration" | "code" | "metadata" | "resource")[]
    }>): void => {
      if (event.categories.includes("metadata")) {
        this.#publish(Object.freeze({type: "package.metadata-updated", packageId: session.packageId, path: event.path}))
      }
      if (event.categories.includes("resource")) {
        this.#publish(Object.freeze({type: "package.resources-updated", packageId: session.packageId, path: event.path}))
      }
      if (event.categories.includes("code")) {
        this.#publish(Object.freeze({type: "package.code-updated", packageId: session.packageId, path: event.path}))
      }
      if (event.categories.some((category) => category === "code" || category === "metadata" || category === "resource")) {
        session.invalidate(event.path)
      }
    }
    if (typeof this.#watch.replaceCategorized === "function") {
      this.#watch.replaceCategorized(session.packageId, categorized, onEvent)
    } else {
      this.#watch.replace(session.packageId, categorized.map(({path}) => path), (path) => {
        onEvent({path, categories: ["code"]})
      })
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("External Storybook session manager is disposed")
  }
}

function uniqueCategorizedPaths(
  paths: readonly Readonly<{path: string, category: "declaration" | "code" | "metadata" | "resource"}>[],
) {
  const seen = new Set<string>()
  return Object.freeze(paths.flatMap((entry) => {
    let path: string
    try {
      path = realpathSync(entry.path)
    } catch {
      path = resolve(entry.path)
    }
    const key = `${entry.category}\0${path}`
    if (seen.has(key)) return []
    seen.add(key)
    return [Object.freeze({path, category: entry.category})]
  }).sort((left, right) => left.path.localeCompare(right.path) || left.category.localeCompare(right.category)))
}
