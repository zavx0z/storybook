import {realpathSync} from "node:fs"
import {resolve} from "node:path"
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
  rebuildDelayMs?: number
}>

/** Owns PackageSessions as a derived runtime view of the canonical graph. */
export class ExternalStorybookSessionManager {
  readonly #artifactRoot: string
  readonly #buildRevision: StorybookPackageRevisionBuilder
  readonly #publish: (event: StorybookPackageEvent) => void
  readonly #watch: StorybookDependencyWatchCoordinator
  readonly #ownsWatch: boolean
  readonly #rebuildDelayMs: number | undefined
  readonly #sessions = new Map<string, StorybookPackageSession>()
  #disposed = false

  constructor(options: ExternalStorybookSessionManagerOptions) {
    this.#artifactRoot = resolve(options.artifactRoot)
    this.#buildRevision = options.buildRevision
    this.#publish = options.publish ?? (() => {})
    this.#rebuildDelayMs = options.rebuildDelayMs
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
      session.dispose()
      this.#sessions.delete(packageId)
    }
    for (const descriptor of descriptors) {
      const current = this.#sessions.get(descriptor.packageId)
      if (current === undefined) {
        const session = new StorybookPackageSession(descriptor, {
          artifactRoot: this.#artifactRoot,
          buildRevision: this.#buildRevision,
          ...(this.#rebuildDelayMs === undefined ? {} : {rebuildDelayMs: this.#rebuildDelayMs}),
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
    if (current.activeRevision !== null && current.buildState === "ready") return current
    return session.build()
  }

  snapshots(): readonly StorybookPackageSessionSnapshot[] {
    this.#assertActive()
    return Object.freeze([...this.#sessions.values()].map((session) => session.snapshot()))
  }

  notifyDependency(path: string): number {
    this.#assertActive()
    return this.#watch.notify(path)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const session of this.#sessions.values()) session.dispose()
    this.#sessions.clear()
    if (this.#ownsWatch) this.#watch.dispose()
  }

  #onSessionEvent(event: StorybookPackageEvent): void {
    const session = this.#sessions.get(event.packageId)
    if (event.type === "package.updated" && session !== undefined) {
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
      ...(descriptor.runtime === null ? [] : [descriptor.runtime.path]),
      ...descriptor.variants.map(({module}) => module.path),
      ...session.snapshot().dependencyRealpaths,
    ]
    this.#watch.replace(session.packageId, uniqueRealpaths(paths), (path) => {
      session.invalidate(path)
    })
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("External Storybook session manager is disposed")
  }
}

function uniqueRealpaths(paths: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(paths.map((path) => {
    try {
      return realpathSync(path)
    } catch {
      return resolve(path)
    }
  }))].sort())
}
