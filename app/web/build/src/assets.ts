import type {SharedBrowserAssets, SharedBrowserAssetsController, SharedBrowserAssetsInput} from "../contract/assets"

/** Готовит Web по явному запросу и заменяет текущий результат после успешной публикации. */
export class StorybookSharedBrowserAssets implements SharedBrowserAssetsController {
  readonly #build: (signal: AbortSignal) => Promise<SharedBrowserAssets>
  readonly #lifetime = new AbortController()
  readonly #updated: (assets: SharedBrowserAssets) => void
  readonly #failed: (error: unknown) => void
  #current: SharedBrowserAssets | null = null
  #prepared: SharedBrowserAssets | null = null
  readonly #commit: (assets: SharedBrowserAssets) => void
  #pending: Promise<SharedBrowserAssets> | null = null
  #disposed = false

  constructor(options: SharedBrowserAssetsInput) {
    this.#commit = options.commit ?? (() => {})
    this.#build = options.build
    this.#updated = options.updated
    this.#failed = options.failed
    if (options.initial !== undefined) {
      this.#current = options.initial
    }
  }

  /** Читает последнюю готовую оболочку без проверки исходников и compiler demand. */
  current(): SharedBrowserAssets {
    if (this.#current === null) throw new Error("Оболочка ещё не собрана. Выполните storybook_check.")
    return this.#current
  }

  /** Запускает сборку по явному check; одновременные запросы используют одну операцию. */
  ensure(): Promise<SharedBrowserAssets> {
    if (this.#disposed) return Promise.reject(new Error("Shared browser assets are disposed"))
    if (this.#pending !== null) return this.#pending
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

  /** Принимает отдельно подготовленный Web на той же опубликованной платформе. */
  stageHost(candidate: SharedBrowserAssets): void {
    if (this.#disposed) throw new Error("Shared browser assets are disposed")
    if (this.#pending !== null) throw new Error("Подготовка среды ещё выполняется")
    const current = this.current()
    if (current.browserIdentity === undefined || candidate.browserIdentity?.epoch !== current.browserIdentity.epoch) {
      throw new Error("Пересборка Web не может заменить опубликованную платформу")
    }
    this.#prepared = candidate
  }

  /** Атомарно заменяет текущую оболочку подготовленным результатом. */
  publish(expected = this.#prepared): SharedBrowserAssets {
    if (this.#prepared === null) throw new Error("Shared host has no prepared candidate")
    if (this.#prepared !== expected) throw new Error("Shared host candidate changed during verification")
    const candidate = Object.freeze({...this.#prepared})
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
    this.#prepared = null
    const candidate = await this.#build(this.#lifetime.signal)
    if (this.#disposed) throw new Error("Shared browser assets disposed")
    this.#prepared = candidate
    return candidate
  }
}
