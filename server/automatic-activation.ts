/** Точная package revision, допущенная к автоматической серверной проверке. */
export type StorybookAutomaticActivationCandidate = Readonly<{
  packageId: string
  revision: string
}>

/** Итог одной попытки автоматического применения. */
export type StorybookAutomaticActivationResult = "applied" | "deferred" | "stale"

/**
Коалесцирует автоматическое применение package revisions в одну серверную очередь.

Для каждого package сохраняется только последняя ожидающая revision. Уже начатая
проверка завершается через собственный bounded lifecycle; следующий проход заново
проверяет актуальность candidate и не создаёт параллельный browser pool.
*/
export class StorybookAutomaticActivationCoordinator {
  readonly #apply: (
    candidate: StorybookAutomaticActivationCandidate,
    signal: AbortSignal,
  ) => Promise<StorybookAutomaticActivationResult>
  readonly #failed: (candidate: StorybookAutomaticActivationCandidate, error: unknown) => void
  readonly #timeoutMs: number
  readonly #pending = new Map<string, StorybookAutomaticActivationCandidate>()
  #controller: AbortController | null = null
  #current: StorybookAutomaticActivationCandidate | null = null
  #runner: Promise<void> | null = null
  #disposed = false

  /** Создаёт одну очередь вокруг переданного exact activation lifecycle. */
  constructor(options: Readonly<{
    apply(
      candidate: StorybookAutomaticActivationCandidate,
      signal: AbortSignal,
    ): Promise<StorybookAutomaticActivationResult>
    failed(candidate: StorybookAutomaticActivationCandidate, error: unknown): void
    timeoutMs?: number
  }>) {
    this.#apply = options.apply
    this.#failed = options.failed
    this.#timeoutMs = boundedAutomaticActivationTimeout(options.timeoutMs ?? 30_000)
  }

  /** Ставит exact revision в очередь, заменяя более раннюю ожидающую revision того же package. */
  request(candidate: StorybookAutomaticActivationCandidate): void {
    if (this.#disposed) return
    this.#pending.set(candidate.packageId, Object.freeze({...candidate}))
    this.#start()
  }

  /** Удаляет pending revision и отменяет текущую проверку exact package. */
  cancel(packageId: string): void {
    this.#pending.delete(packageId)
    if (this.#current?.packageId === packageId) {
      this.#controller?.abort(new Error(`Storybook automatic activation was superseded: ${packageId}`))
    }
  }

  /** Отменяет текущую browser operation и дожидается освобождения очереди. */
  async dispose(): Promise<void> {
    if (this.#disposed) {
      if (this.#runner !== null) await this.#runner
      return
    }
    this.#disposed = true
    this.#pending.clear()
    this.#controller?.abort(new Error("Storybook automatic activation is disposed"))
    if (this.#runner !== null) await this.#runner
  }

  /** Запускает единственный runner поверх коалесцированной очереди. */
  #start(): void {
    if (this.#runner !== null || this.#disposed) return
    const runner = this.#run().finally(() => {
      if (this.#runner === runner) this.#runner = null
      if (!this.#disposed && this.#pending.size > 0) this.#start()
    })
    this.#runner = runner
  }

  /** Последовательно применяет pending revisions без повторения deferred candidate. */
  async #run(): Promise<void> {
    while (!this.#disposed && this.#pending.size > 0) {
      const first = this.#pending.entries().next().value as
        | [string, StorybookAutomaticActivationCandidate]
        | undefined
      if (first === undefined) return
      const [packageId, candidate] = first
      this.#pending.delete(packageId)
      const controller = new AbortController()
      const operationSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.#timeoutMs)])
      this.#controller = controller
      this.#current = candidate
      try {
        await this.#apply(candidate, operationSignal)
      } catch (error) {
        if (!this.#disposed && !controller.signal.aborted) this.#failed(candidate, error)
      } finally {
        if (this.#controller === controller) this.#controller = null
        if (this.#current === candidate) this.#current = null
      }
    }
  }
}

/** Проверяет bounded timeout одной activation operation. */
function boundedAutomaticActivationTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 60_000) {
    throw new Error("Storybook automatic activation timeout must be between 10 and 60000 ms")
  }
  return value
}

/**
Проверяет полный browser evidence перед server-side acknowledgement.

@throws Если package, revision, route, graph, ready/presented frame либо console
не подтверждают exact candidate.
*/
export function assertStorybookActivationEvidence(
  evidence: Readonly<Record<string, unknown>>,
  expected: Readonly<{packageId: string, revision: string, route: string, graphDigest: string}>,
): number {
  const frameSequence = Number(evidence.frameSequence)
  if (evidence.packageId !== expected.packageId || evidence.revision !== expected.revision ||
    evidence.route !== expected.route || evidence.graphDigest !== expected.graphDigest ||
    evidence.ready !== true || evidence.presented !== true || !Number.isSafeInteger(frameSequence) ||
    frameSequence < 1 || !Array.isArray(evidence.consoleErrors) || evidence.consoleErrors.length > 0) {
    throw new Error(`Package candidate did not pass activation verification: ${expected.packageId}`)
  }
  return frameSequence
}
