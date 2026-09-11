import {createHash} from "node:crypto"
import {readFileSync, readdirSync, statSync} from "node:fs"
import type {StorybookDependencyWatchCoordinator} from "../sessions/dependency-watch.ts"
import {storybookBuildInputFingerprintWatchPaths, type StorybookBuildInputFingerprint} from "./build-input-fingerprint.ts"
import type {StorybookPackageRevisionAuthorStyleSheet} from "../sessions/package-revision.ts"
import type {StorybookSharedBrowserIdentity} from "./types/shared-module-identity.ts"

/**
Готовые ресурсы общей оболочки и свидетельство их исходников.

@property root - Каталог immutable ресурсов; старые hashed файлы сохраняются для открытых страниц.

@property landingEntry - Относительный путь готового entry главной страницы.

@property fallbackEntry - Относительный путь entry страницы без применённой пакетной ревизии.

@property dependencyRealpaths - Канонические зависимости browser metafile.

@property [inputFingerprint] - Полные проверенные входы, включая config и ambient declarations.

@property [artifactDigests] - SHA-256 опубликованных файлов; повреждение исключает восстановление receipt.

@property [cacheHit] - Worker восстановил готовые ресурсы без запуска Bun.build.
*/
export type SharedBrowserAssets = Readonly<{
  root: string
  landingEntry: string
  fallbackEntry: string
  browserIdentity?: StorybookSharedBrowserIdentity
  dependencyRealpaths: readonly string[]
  inputFingerprint?: StorybookBuildInputFingerprint
  artifactDigests?: readonly Readonly<{path: string, digest: string}>[]
  cacheHit?: boolean
  authorStyleSheets?: readonly StorybookPackageRevisionAuthorStyleSheet[]
}>

/** One shared browser build, independently invalidated from package revisions. */
export class StorybookSharedBrowserAssets {
  readonly #watch: StorybookDependencyWatchCoordinator
  readonly #build: (signal: AbortSignal) => Promise<SharedBrowserAssets>
  readonly #lifetime = new AbortController()
  readonly #subscribed: () => boolean
  readonly #updated: (assets: SharedBrowserAssets) => void
  readonly #failed: (error: unknown) => void
  readonly #cacheProgress: (event: Readonly<{state: "started" | "completed", hit?: boolean}>) => void
  #current: SharedBrowserAssets | null = null
  #fingerprint = ""
  #pending: Promise<SharedBrowserAssets> | null = null
  #generation = 0
  #dirty = true
  #disposed = false

  constructor(options: Readonly<{
    /** Уже проверенные владельцем receipt assets; не доверенный произвольный кэш. */
    initial?: SharedBrowserAssets
    watch: StorybookDependencyWatchCoordinator
    build: (signal: AbortSignal) => Promise<SharedBrowserAssets>
    subscribed: () => boolean
    updated: (assets: SharedBrowserAssets) => void
    failed: (error: unknown) => void
    cacheProgress?: (event: Readonly<{state: "started" | "completed", hit?: boolean}>) => void
  }>) {
    this.#watch = options.watch
    this.#build = options.build
    this.#subscribed = options.subscribed
    this.#updated = options.updated
    this.#failed = options.failed
    this.#cacheProgress = options.cacheProgress ?? (() => {})
    if (options.initial !== undefined) {
      this.#current = options.initial
      this.#fingerprint = fingerprint(watchedInputs(options.initial))
      this.#dirty = false
      this.#installWatch(options.initial)
    }
  }

  ensure(): Promise<SharedBrowserAssets> {
    if (this.#disposed) return Promise.reject(new Error("Shared browser assets are disposed"))
    if (this.#pending !== null) return this.#pending
    if (this.#current !== null && !this.#dirty) {
      this.#reportCacheProgress({state: "started"})
      const hit = fingerprint(watchedInputs(this.#current)) === this.#fingerprint
      this.#reportCacheProgress({state: "completed", hit})
      if (hit) return Promise.resolve(this.#current)
    }
    this.#dirty = true
    const pending = this.#refresh().catch(error => {
      if (!this.#disposed) this.#failed(error)
      if (this.#current !== null && !this.#disposed) return this.#current
      throw error
    }).finally(() => {
      if (this.#pending === pending) this.#pending = null
    })
    this.#pending = pending
    return pending
  }

  /** Отменяет собственную операцию и завершается после подтверждённого cleanup worker. */
  async dispose(): Promise<void> {
    this.#disposed = true
    this.#lifetime.abort(new DOMException("Shared browser assets disposed", "AbortError"))
    this.#watch.remove("__shared_browser__")
    await this.#pending?.catch(() => {})
  }

  async #refresh(): Promise<SharedBrowserAssets> {
    for (;;) {
      const generation = this.#generation
      const candidate = await this.#build(this.#lifetime.signal)
      if (this.#disposed) throw new Error("Shared browser assets are disposed")
      this.#installWatch(candidate)
      if (generation !== this.#generation) continue
      const previous = this.#current
      this.#current = candidate
      this.#fingerprint = fingerprint(watchedInputs(candidate))
      this.#dirty = false
      if (previous !== null && (previous.landingEntry !== candidate.landingEntry ||
        previous.fallbackEntry !== candidate.fallbackEntry)) this.#updated(candidate)
      return candidate
    }
  }

  /** Следит за точными входами принятой общей сборки, включая восстановленную. */
  #installWatch(assets: SharedBrowserAssets): void {
    this.#watch.replace("__shared_browser__", watchedInputs(assets), () => {
      this.#generation += 1
      this.#dirty = true
      if (this.#subscribed()) void this.ensure().catch(() => {})
    })
  }

  /** Сообщает только browser-подписчикам о фактической проверке горячего shared cache. */
  #reportCacheProgress(event: Readonly<{state: "started" | "completed", hit?: boolean}>): void {
    this.#cacheProgress(event)
  }
}

/** Включает config и ambient inputs, отсутствующие в runtime metafile. */
function watchedInputs(assets: SharedBrowserAssets): readonly string[] {
  return [...new Set([...assets.dependencyRealpaths,
    ...(storybookBuildInputFingerprintWatchPaths(assets.inputFingerprint) ?? []),
  ])]
}

function fingerprint(paths: readonly string[]): string {
  const hash = createHash("sha256")
  for (const path of paths) {
    hash.update(`${path}\0`)
    try {
      if (statSync(path).isDirectory()) {
        hash.update(JSON.stringify(readdirSync(path).sort()))
        hash.update("\0")
        continue
      }
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
