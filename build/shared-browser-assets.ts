import {createHash} from "node:crypto"
import {readFileSync, readdirSync, statSync} from "node:fs"
import {storybookBuildInputPaths, type StorybookBuildInputFingerprint} from "./build-input-fingerprint.ts"
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
  bootstrapEntry?: string
  compatibleHosts?: readonly Readonly<{sharedModuleEpoch: string, hostModuleEpoch: string}>[]
  browserIdentity?: StorybookSharedBrowserIdentity
  dependencyRealpaths: readonly string[]
  inputFingerprint?: StorybookBuildInputFingerprint
  artifactDigests?: readonly Readonly<{path: string, digest: string}>[]
  cacheHit?: boolean
  authorStyleSheets?: readonly StorybookPackageRevisionAuthorStyleSheet[]
}>

/** One shared browser build, prepared explicitly alongside package revisions. */
export class StorybookSharedBrowserAssets {
  readonly #build: (signal: AbortSignal) => Promise<SharedBrowserAssets>
  readonly #lifetime = new AbortController()
  readonly #updated: (assets: SharedBrowserAssets) => void
  readonly #failed: (error: unknown) => void
  readonly #cacheProgress: (event: Readonly<{state: "started" | "completed", hit?: boolean}>) => void
  #current: SharedBrowserAssets | null = null
  #prepared: SharedBrowserAssets | null = null
  readonly #commit: (assets: SharedBrowserAssets) => void
  #fingerprint = ""
  #pending: Promise<SharedBrowserAssets> | null = null
  #disposed = false

  constructor(options: Readonly<{
    /** Уже проверенные владельцем receipt assets; не доверенный произвольный кэш. */
    initial?: SharedBrowserAssets
    commit?(assets: SharedBrowserAssets): void
    build: (signal: AbortSignal) => Promise<SharedBrowserAssets>
    updated: (assets: SharedBrowserAssets) => void
    failed: (error: unknown) => void
    cacheProgress?: (event: Readonly<{state: "started" | "completed", hit?: boolean}>) => void
  }>) {
    this.#commit = options.commit ?? (() => {})
    this.#build = options.build
    this.#updated = options.updated
    this.#failed = options.failed
    this.#cacheProgress = options.cacheProgress ?? (() => {})
    if (options.initial !== undefined) {
      this.#current = options.initial
    }
  }

  /** Читает последнюю готовую оболочку без проверки исходников и compiler demand. */
  current(): SharedBrowserAssets {
    if (this.#current === null) throw new Error("Оболочка ещё не собрана. Выполните storybook_check.")
    return this.#current
  }

  /** Проверяет входы и подготавливает оболочку по явному check. */
  ensure(): Promise<SharedBrowserAssets> {
    if (this.#disposed) return Promise.reject(new Error("Shared browser assets are disposed"))
    if (this.#pending !== null) return this.#pending
    const cached = this.#prepared ?? this.#current
    if (cached !== null && this.#fingerprint !== "") {
      this.#reportCacheProgress({state: "started"})
      const hit = fingerprint(buildInputs(cached)) === this.#fingerprint
      this.#reportCacheProgress({state: "completed", hit})
      if (hit) return Promise.resolve(cached)
    }
    const pending = this.#refresh().catch(error => {
      if (!this.#disposed) this.#failed(error)
      throw error
    }).finally(() => {
      if (this.#pending === pending) this.#pending = null
    })
    this.#pending = pending
    return pending
  }

  /** Возвращает подготовленную версию только для явного просмотра кандидата. */
  prepared(): SharedBrowserAssets | null { return this.#prepared }

  /** Единым commit публикует подготовленную оболочку и её варианты для сохранённых платформ. */
  publish(variants: readonly SharedBrowserAssets[] = [], expected = this.#prepared): SharedBrowserAssets {
    if (this.#prepared === null) throw new Error("Shared host has no prepared candidate")
    if (this.#prepared !== expected) throw new Error("Shared host candidate changed during verification")
    const candidate = Object.freeze({...this.#prepared, compatibleHosts: Object.freeze(variants.flatMap(assets =>
      assets.browserIdentity ? [{sharedModuleEpoch: assets.browserIdentity.epoch, hostModuleEpoch: assets.browserIdentity.hostModuleEpoch}] : []))})
    this.#commit(candidate)
    this.#current = candidate
    this.#updated(candidate)
    return candidate
  }

  /** Отменяет собственную операцию и завершается после подтверждённого cleanup worker. */
  async dispose(): Promise<void> {
    this.#disposed = true
    this.#lifetime.abort(new DOMException("Shared browser assets disposed", "AbortError"))
    await this.#pending?.catch(() => {})
  }

  async #refresh(): Promise<SharedBrowserAssets> {
    const candidate = await this.#build(this.#lifetime.signal)
    if (this.#disposed) throw new Error("Shared browser assets disposed")
    this.#prepared = candidate
    this.#fingerprint = fingerprint(buildInputs(candidate))
    return candidate
  }

  /** Сообщает browser-подписчикам результат явной проверки shared cache. */
  #reportCacheProgress(event: Readonly<{state: "started" | "completed", hit?: boolean}>): void {
    this.#cacheProgress(event)
  }
}

/** Включает config и ambient inputs, отсутствующие в runtime metafile. */
function buildInputs(assets: SharedBrowserAssets): readonly string[] {
  return [...new Set([...assets.dependencyRealpaths,
    ...(storybookBuildInputPaths(assets.inputFingerprint) ?? []),
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
