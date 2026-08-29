import {
  realpathSync,
  unwatchFile as nodeUnwatchFile,
  watchFile as nodeWatchFile,
  type Stats,
} from "node:fs"
import {resolve} from "node:path"

export const STORYBOOK_DEPENDENCY_WATCH_INTERVAL_MS = 200
export const STORYBOOK_DEPENDENCY_WATCH_MIN_INTERVAL_MS = 25
export const STORYBOOK_DEPENDENCY_WATCH_MAX_INTERVAL_MS = 5_000

export type StorybookDependencyWatchCallback = (canonicalPath: string) => void

export type StorybookDependencyWatchListener = (
  current: Stats,
  previous: Stats,
) => void

export type StorybookDependencyWatchFile = (
  canonicalPath: string,
  options: Readonly<{persistent: false; interval: number}>,
  listener: StorybookDependencyWatchListener,
) => void

export type StorybookDependencyUnwatchFile = (
  canonicalPath: string,
  listener: StorybookDependencyWatchListener,
) => void

export type StorybookDependencyWatchError = Readonly<{
  packageId: string
  path: string
  error: unknown
}>

export type StorybookDependencyWatchCoordinatorOptions = Readonly<{
  intervalMs?: number
  watchFile?: StorybookDependencyWatchFile
  unwatchFile?: StorybookDependencyUnwatchFile
  onError?(error: StorybookDependencyWatchError): void
}>

type WatchedPath = {
  listener: StorybookDependencyWatchListener
  callbacks: Map<string, StorybookDependencyWatchCallback>
}

type PackageRegistration = Readonly<{
  paths: ReadonlySet<string>
  aliases: ReadonlyMap<string, string>
}>

type AliasRegistration = {
  canonicalPath: string
  packageIds: Set<string>
}

/**
 * Owns one polling watcher for each canonical dependency realpath.
 *
 * Package registrations are replaceable projections over that shared watcher.
 * A deleted path keeps its canonical identity until the last package removes
 * it, allowing `watchFile` and deterministic notifications to observe a later
 * recreation without constructing a second registry.
 */
export class StorybookDependencyWatchCoordinator {
  readonly #intervalMs: number
  readonly #watchFile: StorybookDependencyWatchFile
  readonly #unwatchFile: StorybookDependencyUnwatchFile
  readonly #onError: (error: StorybookDependencyWatchError) => void
  readonly #watchedPaths = new Map<string, WatchedPath>()
  readonly #packages = new Map<string, PackageRegistration>()
  readonly #aliases = new Map<string, AliasRegistration>()
  #disposed = false

  constructor(options: StorybookDependencyWatchCoordinatorOptions = {}) {
    this.#intervalMs = watchInterval(options.intervalMs)
    this.#watchFile = options.watchFile ?? ((path, watchOptions, listener) => {
      nodeWatchFile(path, watchOptions, listener)
    })
    this.#unwatchFile = options.unwatchFile ?? ((path, listener) => {
      nodeUnwatchFile(path, listener)
    })
    this.#onError = options.onError ?? (() => {})
  }

  /** Atomically replaces one package's dependency projection and callback. */
  replace(
    packageId: string,
    paths: readonly string[],
    callback: StorybookDependencyWatchCallback,
  ): readonly string[] {
    this.#assertActive()
    const id = requiredText("packageId", packageId)
    if (!Array.isArray(paths)) throw new TypeError("Storybook dependency paths must be an array")
    if (typeof callback !== "function") {
      throw new TypeError(`Storybook dependency callback must be a function: ${id}`)
    }

    const nextAliases = new Map<string, string>()
    const nextPaths = new Set<string>()
    for (const [index, path] of paths.entries()) {
      const lexicalPath = resolve(requiredText(`paths[${index}]`, path))
      const canonicalPath = realpathSync(lexicalPath)
      nextAliases.set(lexicalPath, canonicalPath)
      nextPaths.add(canonicalPath)
    }
    this.#validateAliases(id, nextAliases)

    const created: string[] = []
    try {
      for (const path of nextPaths) {
        if (this.#watchedPaths.has(path)) continue
        this.#createWatch(path)
        created.push(path)
      }
    } catch (error) {
      for (const path of created) this.#deleteWatch(path)
      throw error
    }

    const previous = this.#packages.get(id)
    if (previous !== undefined) {
      this.#removeAliases(id, previous.aliases)
      for (const path of previous.paths) {
        if (nextPaths.has(path)) continue
        this.#removeCallback(path, id)
      }
    }

    for (const path of nextPaths) this.#watchedPaths.get(path)!.callbacks.set(id, callback)
    this.#addAliases(id, nextAliases)
    if (nextPaths.size === 0) this.#packages.delete(id)
    else this.#packages.set(id, Object.freeze({paths: nextPaths, aliases: nextAliases}))
    return Object.freeze([...nextPaths].sort())
  }

  /** Removes one package without disturbing dependencies still used by peers. */
  remove(packageId: string): boolean {
    if (this.#disposed) return false
    const id = requiredText("packageId", packageId)
    const registration = this.#packages.get(id)
    if (registration === undefined) return false
    this.#packages.delete(id)
    this.#removeAliases(id, registration.aliases)
    for (const path of registration.paths) this.#removeCallback(path, id)
    return true
  }

  /** Delivers one deterministic change notification to every package owner. */
  notify(path: string): number {
    if (this.#disposed) return 0
    const lexicalPath = resolve(requiredText("path", path))
    const canonicalPath = canonicalNotificationPath(
      lexicalPath,
      this.#watchedPaths,
      this.#aliases,
    )
    return this.#notifyCanonical(canonicalPath)
  }

  /** Stops every owned watcher once. Repeated disposal is a no-op. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const path of [...this.#watchedPaths.keys()]) this.#deleteWatch(path)
    this.#packages.clear()
    this.#aliases.clear()
  }

  #createWatch(path: string): void {
    const listener: StorybookDependencyWatchListener = () => {
      if (!this.#disposed) this.#notifyCanonical(path)
    }
    this.#watchFile(path, {persistent: false, interval: this.#intervalMs}, listener)
    this.#watchedPaths.set(path, {listener, callbacks: new Map()})
  }

  #deleteWatch(path: string): void {
    const watched = this.#watchedPaths.get(path)
    if (watched === undefined) return
    this.#watchedPaths.delete(path)
    this.#unwatchFile(path, watched.listener)
  }

  #removeCallback(path: string, packageId: string): void {
    const watched = this.#watchedPaths.get(path)
    if (watched === undefined) return
    watched.callbacks.delete(packageId)
    if (watched.callbacks.size === 0) this.#deleteWatch(path)
  }

  #notifyCanonical(path: string): number {
    const watched = this.#watchedPaths.get(path)
    if (watched === undefined) return 0
    const callbacks = [...watched.callbacks.entries()]
    for (const [packageId, callback] of callbacks) {
      try {
        callback(path)
      } catch (error) {
        this.#onError(Object.freeze({packageId, path, error}))
      }
    }
    return callbacks.length
  }

  #validateAliases(packageId: string, aliases: ReadonlyMap<string, string>): void {
    for (const [lexicalPath, canonicalPath] of aliases) {
      const existing = this.#aliases.get(lexicalPath)
      if (existing === undefined || existing.canonicalPath === canonicalPath) continue
      const foreign = [...existing.packageIds].filter((id) => id !== packageId)
      if (foreign.length > 0) {
        throw new Error(
          `Storybook dependency alias resolves ambiguously: ${lexicalPath}`,
        )
      }
    }
  }

  #addAliases(packageId: string, aliases: ReadonlyMap<string, string>): void {
    for (const [lexicalPath, canonicalPath] of aliases) {
      const existing = this.#aliases.get(lexicalPath)
      if (existing !== undefined && existing.canonicalPath === canonicalPath) {
        existing.packageIds.add(packageId)
        continue
      }
      this.#aliases.set(lexicalPath, {
        canonicalPath,
        packageIds: new Set([packageId]),
      })
    }
  }

  #removeAliases(packageId: string, aliases: ReadonlyMap<string, string>): void {
    for (const lexicalPath of aliases.keys()) {
      const existing = this.#aliases.get(lexicalPath)
      if (existing === undefined) continue
      existing.packageIds.delete(packageId)
      if (existing.packageIds.size === 0) this.#aliases.delete(lexicalPath)
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Storybook dependency watch coordinator is disposed")
  }
}

function canonicalNotificationPath(
  lexicalPath: string,
  watchedPaths: ReadonlyMap<string, WatchedPath>,
  aliases: ReadonlyMap<string, AliasRegistration>,
): string {
  try {
    const canonicalPath = realpathSync(lexicalPath)
    if (watchedPaths.has(canonicalPath)) return canonicalPath
  } catch {
    // A deleted dependency keeps the alias recorded by its last successful build.
  }
  return aliases.get(lexicalPath)?.canonicalPath ?? lexicalPath
}

function watchInterval(value = STORYBOOK_DEPENDENCY_WATCH_INTERVAL_MS): number {
  if (!Number.isInteger(value) ||
    value < STORYBOOK_DEPENDENCY_WATCH_MIN_INTERVAL_MS ||
    value > STORYBOOK_DEPENDENCY_WATCH_MAX_INTERVAL_MS) {
    throw new Error(`Invalid Storybook dependency watch interval: ${String(value)}`)
  }
  return value
}

function requiredText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Storybook dependency ${label} must be non-empty text`)
  }
  return value
}
