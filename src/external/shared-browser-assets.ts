import {createHash} from "node:crypto"
import {readFileSync} from "node:fs"
import type {StorybookDependencyWatchCoordinator} from "./dependency-watch.ts"

export type SharedBrowserAssets = Readonly<{
  root: string
  landingEntry: string
  fallbackEntry: string
  dependencyRealpaths: readonly string[]
}>

/** One shared browser build, independently invalidated from package revisions. */
export class StorybookSharedBrowserAssets {
  readonly #watch: StorybookDependencyWatchCoordinator
  readonly #build: () => Promise<SharedBrowserAssets>
  readonly #subscribed: () => boolean
  readonly #updated: (assets: SharedBrowserAssets) => void
  readonly #failed: (error: unknown) => void
  #current: SharedBrowserAssets | null = null
  #fingerprint = ""
  #pending: Promise<SharedBrowserAssets> | null = null
  #generation = 0
  #dirty = true
  #disposed = false

  constructor(options: Readonly<{
    watch: StorybookDependencyWatchCoordinator
    build: () => Promise<SharedBrowserAssets>
    subscribed: () => boolean
    updated: (assets: SharedBrowserAssets) => void
    failed: (error: unknown) => void
  }>) {
    this.#watch = options.watch
    this.#build = options.build
    this.#subscribed = options.subscribed
    this.#updated = options.updated
    this.#failed = options.failed
  }

  ensure(): Promise<SharedBrowserAssets> {
    if (this.#disposed) return Promise.reject(new Error("Shared browser assets are disposed"))
    if (this.#pending !== null) return this.#pending
    if (this.#current !== null && !this.#dirty &&
      fingerprint(this.#current.dependencyRealpaths) === this.#fingerprint) {
      return Promise.resolve(this.#current)
    }
    this.#dirty = true
    const pending = this.#refresh().catch(error => {
      this.#failed(error)
      if (this.#current !== null && !this.#disposed) return this.#current
      throw error
    }).finally(() => {
      if (this.#pending === pending) this.#pending = null
    })
    this.#pending = pending
    return pending
  }

  dispose(): void {
    this.#disposed = true
    this.#watch.remove("__shared_browser__")
  }

  async #refresh(): Promise<SharedBrowserAssets> {
    for (;;) {
      const generation = this.#generation
      const candidate = await this.#build()
      if (this.#disposed) throw new Error("Shared browser assets are disposed")
      this.#watch.replace("__shared_browser__", candidate.dependencyRealpaths, () => {
        this.#generation += 1
        this.#dirty = true
        if (this.#subscribed()) void this.ensure().catch(() => {})
      })
      if (generation !== this.#generation) continue
      const previous = this.#current
      this.#current = candidate
      this.#fingerprint = fingerprint(candidate.dependencyRealpaths)
      this.#dirty = false
      if (previous !== null && (previous.landingEntry !== candidate.landingEntry ||
        previous.fallbackEntry !== candidate.fallbackEntry)) this.#updated(candidate)
      return candidate
    }
  }
}

function fingerprint(paths: readonly string[]): string {
  const hash = createHash("sha256")
  for (const path of paths) {
    hash.update(`${path}\0`)
    try {
      const bytes = readFileSync(path)
      hash.update(`${bytes.length}:`)
      hash.update(bytes)
    } catch {
      hash.update("missing")
    }
    hash.update("\0")
  }
  return hash.digest("hex")
}
