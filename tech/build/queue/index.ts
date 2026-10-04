/**
Ограничивает одновременное исполнение работ и сообщает наблюдаемые переходы.
Очередь владеет допуском, отменой ожидания и измерением привязанных процессов.
Данные работы принадлежат вызывающей стороне: очередь не выбирает исходники,
не компилирует пакет и не применяет готовый результат. Исполнитель завершает
собственные ресурсы до освобождения slot, в том числе при отмене.

@packageDocumentation
*/
import {randomUUID} from "node:crypto"
import ProcessResourceSampler from "@zavx0z/storybook-tech-process-sample"
import measureProcessResources, {type Zavx0zStorybookTechProcessMeasure} from "@zavx0z/storybook-tech-process-measure"
import type {Zavx0zStorybookTechBuildQueue as BuildQueueContract} from "./contract"
import type {BuildCompletion, BuildOperation, BuildOutcome, BuildResources, BuildState} from "./contract/operation"
import type {BuildAdmission, BuildContext, BuildRequest, BuildTransition} from "./src/operation"
export type {Zavx0zStorybookTechBuildQueue} from "./contract"

type BuildQueueInput = BuildQueueContract.Input
type BuildQueueSnapshot<Details extends object> = BuildQueueContract.Output<Details>
type ResourceSampler = Pick<InstanceType<typeof ProcessResourceSampler>, "sample">
type ProcessBinding = Zavx0zStorybookTechProcessMeasure.Input["binding"]
type MeasuredResources = Zavx0zStorybookTechProcessMeasure.Output

/** Изменяемое исполнение; private process binding никогда не проецируется в snapshot. */
type OperationRecord<Details extends object> = {
  operationId: string
  details: Details
  signal: AbortSignal
  state: BuildState
  phase: string
  queuedAtMs: number
  startedAtMs: number | null
  completedAtMs: number | null
  worker: ProcessBinding | null
  resources: BuildResources
  resolve(admission: BuildAdmission<Details>): void
  reject(error: unknown): void
  onAbort(): void
}

/** FIFO-очередь с ограничением исполнения и независимым чтением состояния. */
export default class Zavx0zStorybookTechBuildQueue<Details extends object> {
  readonly #limit: number
  readonly #recentLimit: number
  readonly #resourceSampleThrottleMs: number
  readonly #resourceSampler: ResourceSampler
  readonly #now: () => number
  readonly #pending: OperationRecord<Details>[] = []
  readonly #active = new Map<string, OperationRecord<Details>>()
  readonly #recent: BuildCompletion<Details>[] = []
  readonly #listeners = new Set<((transition: BuildTransition<Details>) => void)>()
  #lastResourceSampleMs = Number.NEGATIVE_INFINITY
  #disposed = false
  readonly #isTimeout: (error: unknown, signal: AbortSignal) => boolean

  /** Создаёт пустую очередь; настройки проверяются до появления работ. */
  constructor(normalized: BuildQueueInput = {}) {
    this.#limit = boundedInteger(
      normalized.limit ?? 1,
      1,
      8,
      "build concurrency",
    )
    this.#recentLimit = boundedInteger(normalized.recentLimit ?? 32, 0, 256, "recent build limit")
    this.#resourceSampleThrottleMs = boundedInteger(
      normalized.resourceSampleThrottleMs ?? 1_000,
      1_000,
      60_000,
      "resource sample throttle",
    )
    this.#resourceSampler = normalized.resourceSampler ?? new ProcessResourceSampler()
    this.#now = normalized.now ?? Date.now
    this.#isTimeout = normalized.isTimeout ?? isTimeoutOutcome
  }

  /** Число допущенных работ, включая незавершённую отмену. */
  get active(): number {
    return this.#active.size
  }

  /** Число работ, ещё не получивших slot. */
  get pending(): number {
    return this.#pending.length
  }

  /**
  Подписывает информационного потребителя на будущие operation transitions.

  Текущее состояние не воспроизводится: для начального baseline владелец читает
  {@link snapshot}. Возвращённая отмена подписки идемпотентна.
  */
  subscribe(listener: ((transition: BuildTransition<Details>) => void)): () => void {
    if (typeof listener !== "function") throw new TypeError("Build transition listener must be callable")
    if (this.#disposed) throw new Error("Build scheduler is disposed")
    this.#listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.#listeners.delete(listener)
    }
  }

  /** Исполняет работу после FIFO-допуска; slot сохраняется до завершения callback и его cleanup. */
  async run<Value>(
    request: BuildRequest<Details>,
    operation: (context: BuildContext<Details>) => Promise<Value>,
    signal: AbortSignal,
  ): Promise<Value> {
    if (typeof operation !== "function") throw new TypeError("Build operation must be callable")
    const admission = await this.#acquire(request, signal)
    let outcome: BuildOutcome = "failed"
    try {
      signal.throwIfAborted()
      const value = await operation(admission.context)
      if (signal.aborted) throw abortError(signal.reason)
      outcome = "completed"
      return value
    } catch (error) {
      outcome = this.#isTimeout(error, signal) ? "timed-out" : signal.aborted ? "canceled" : "failed"
      throw error
    } finally {
      admission.finish(outcome)
    }
  }

  /** Предоставляет явное владение slot; вызывающий обязан завершить admission после cleanup. */
  acquire(request: BuildRequest<Details>, signal: AbortSignal): Promise<BuildAdmission<Details>> {
    return this.#acquire(request, signal)
  }

  /**
  Возвращает согласованный snapshot и опционально обновляет реальные resources.

  Сэмплирование выполняется не чаще throttle и только этим read-only вызовом.
  Оно никогда не запускает compiler job и не меняет admission.
  */
  snapshot(options: Readonly<{sampleResources?: boolean}> = {}): BuildQueueSnapshot<Details> {
    const now = this.#now()
    if (options.sampleResources === true && now - this.#lastResourceSampleMs >= this.#resourceSampleThrottleMs) {
      this.#sampleResources(now)
    }
    const active = Object.freeze([...this.#active.values()].map((record) => operationSnapshot(record, now)))
    const queued = Object.freeze(this.#pending.map((record) => operationSnapshot(record, now)))
    return Object.freeze({
      sampledAt: new Date(now).toISOString(),
      limit: this.#limit,
      activeCount: active.length,
      queuedCount: queued.length,
      active,
      queued,
      recent: Object.freeze([...this.#recent]),
    })
  }

  /** Отменяет только queued operations; cleanup уже admitted jobs остаётся их владельцу. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const record of this.#pending.splice(0)) {
      record.signal.removeEventListener("abort", record.onAbort)
      this.#finish(record, "canceled")
      record.reject(new Error("Build scheduler is disposed"))
    }
    this.#listeners.clear()
  }

  /** Проверяет identity, регистрирует отмену и ставит работу в FIFO. */
  #acquire(request: BuildRequest<Details>, signal: AbortSignal): Promise<BuildAdmission<Details>> {
    if (this.#disposed) return Promise.reject(new Error("Build scheduler is disposed"))
    if (!(signal instanceof AbortSignal)) return Promise.reject(new TypeError("Build signal is invalid"))
    if (signal.aborted) return Promise.reject(abortError(signal.reason))
    const normalized = normalizeRequest(request)
    if (this.#pending.some(({operationId}) => operationId === normalized.operationId) ||
      this.#active.has(normalized.operationId) ||
      this.#recent.some(({operationId}) => operationId === normalized.operationId)) {
      return Promise.reject(new Error(`Duplicate Build operation id: ${normalized.operationId}`))
    }
    return new Promise<BuildAdmission<Details>>((resolvePromise, reject) => {
      const record: OperationRecord<Details> = {
        ...normalized,
        signal,
        state: "queued",
        phase: "admission",
        queuedAtMs: this.#now(),
        startedAtMs: null,
        completedAtMs: null,
        worker: null,
        resources: emptyResourceSnapshot(),
        resolve: resolvePromise,
        reject,
        onAbort: () => {
          if (record.startedAtMs !== null) {
            if (record.state === "canceling") return
            record.state = "canceling"
            this.#publishTransition(record)
            return
          }
          const index = this.#pending.indexOf(record)
          if (index >= 0) this.#pending.splice(index, 1)
          this.#finish(record, this.#isTimeout(signal.reason, signal) ? "timed-out" : "canceled")
          reject(abortError(signal.reason))
        },
      }
      signal.addEventListener("abort", record.onAbort, {once: true})
      this.#pending.push(record)
      this.#publishTransition(record)
      this.#drain()
    })
  }

  /** Создаёт контекст допущенной работы и идемпотентное освобождение. */
  #admit(record: OperationRecord<Details>): BuildAdmission<Details> {
    record.startedAtMs = this.#now()
    record.state = "running"
    this.#active.set(record.operationId, record)
    this.#publishTransition(record)
    const context: BuildContext<Details> = Object.freeze({
      operationId: record.operationId,
      signal: record.signal,
      queuedAt: new Date(record.queuedAtMs).toISOString(),
      startedAt: new Date(record.startedAtMs).toISOString(),
      setPhase: (phase) => {
        if (record.completedAtMs !== null) return
        const normalized = normalizePhase(phase)
        if (record.phase === normalized) return
        record.phase = normalized
        this.#publishTransition(record)
      },
      bindWorker: (binding) => {
        if (record.completedAtMs !== null) return () => {}
        const normalized = normalizeWorkerBinding(binding)
        record.worker = normalized
        let bound = true
        return () => {
          if (!bound || record.worker !== normalized) return
          bound = false
          record.worker = null
        }
      },
      clearWorker: () => {
        record.worker = null
      },
      setDetails: details => {
        if (record.completedAtMs !== null) return
        record.details = freezeDetails(details)
        this.#publishTransition(record)
      },
    })
    let finished = false
    return Object.freeze({
      context,
      finish: (outcome) => {
        if (finished) return
        finished = true
        this.#finish(record, outcome)
        this.#drain()
      },
    })
  }

  /** Сохраняет единственный terminal transition и освобождает ссылки на исполнение. */
  #finish(record: OperationRecord<Details>, outcome: BuildOutcome): void {
    if (record.completedAtMs !== null) return
    const completedAtMs = this.#now()
    record.completedAtMs = completedAtMs
    record.signal.removeEventListener("abort", record.onAbort)
    this.#active.delete(record.operationId)
    const snapshot = operationSnapshot(record, completedAtMs)
    this.#publishTransition(record, outcome)
    if (this.#recentLimit > 0) {
      this.#recent.unshift(Object.freeze({
        ...snapshot,
        state: "completed",
        outcome,
        completedAt: new Date(completedAtMs).toISOString(),
      }))
      if (this.#recent.length > this.#recentLimit) this.#recent.length = this.#recentLimit
    }
  }

  /** Допускает ожидающие работы, пока есть свободные slots. */
  #drain(): void {
    while (!this.#disposed && this.#active.size < this.#limit && this.#pending.length > 0) {
      const record = this.#pending.shift()!
      if (record.signal.aborted) {
        this.#finish(record, this.#isTimeout(record.signal.reason, record.signal) ? "timed-out" : "canceled")
        record.reject(abortError(record.signal.reason))
        continue
      }
      record.resolve(this.#admit(record))
    }
  }

  /** Использует один системный снимок для всех привязанных worker. */
  #sampleResources(now: number): void {
    const bound = [...this.#active.values()].filter(({worker}) => worker !== null)
    if (bound.length === 0) return
    this.#lastResourceSampleMs = now
    let rows
    try {
      rows = this.#resourceSampler.sample()
    } catch {
      rows = Object.freeze([])
    }
    const sampledAt = new Date(now).toISOString()
    for (const record of bound) {
      const measured = measureProcessResources({binding: record.worker!, rows})
      record.resources = resourceSnapshot(record.resources, measured, sampledAt)
    }
  }

  /** Публикует immutable transition, изолируя ошибки информационных listeners. */
  #publishTransition(record: OperationRecord<Details>, outcome?: BuildOutcome): void {
    const transition: BuildTransition<Details> = outcome === undefined
      ? Object.freeze({
        at: new Date(this.#now()).toISOString(),
        operationId: record.operationId,
        details: record.details,
        state: record.state,
        phase: record.phase,
      })
      : Object.freeze({
        at: new Date(record.completedAtMs ?? this.#now()).toISOString(),
        operationId: record.operationId,
        details: record.details,
        state: "completed",
        phase: record.phase,
        outcome,
      })
    for (const listener of this.#listeners) {
      try {
        listener(transition)
      } catch (error) {
        console.error(`Build transition publication failed for ${record.operationId}`, error)
      }
    }
  }
}

/** Проверяет техническую identity; предметное содержимое details не интерпретируется. */
function normalizeRequest<Details extends object>(request: BuildRequest<Details>) {
  if (request === null || typeof request !== "object") throw new TypeError("Build request must be an object")
  const operationId = request.operationId ?? randomUUID()
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(operationId)) throw new Error(`Invalid build operation id: ${operationId}`)
  return Object.freeze({operationId, details: freezeDetails(request.details)})
}

/** Фиксирует поверхностный снимок данных владельца для текущего перехода. */
function freezeDetails<Details extends object>(details: Details): Details {
  if (details === null || typeof details !== "object" || Array.isArray(details)) throw new TypeError("Build details must be an object")
  return Object.freeze({...details})
}

/** Этап — непустое имя из словаря владельца операции. */
function normalizePhase(phase: string): string {
  if (typeof phase !== "string" || phase.trim().length === 0) throw new TypeError("Build phase must be non-empty")
  return phase
}

/** Проверяет private process binding без чтения либо управления процессом. */
function normalizeWorkerBinding(binding: ProcessBinding): ProcessBinding {
  if (binding === null || typeof binding !== "object" || !Number.isSafeInteger(binding.pid) || binding.pid < 1) {
    throw new Error(`Invalid build build worker PID: ${String(binding?.pid)}`)
  }
  if (binding.startedAt !== undefined && !Number.isFinite(Date.parse(binding.startedAt))) {
    throw new Error(`Invalid build build worker start: ${binding.startedAt}`)
  }
  return Object.freeze({...binding})
}

/** Проецирует record, вычисляя duration относительно одного согласованного времени. */
function operationSnapshot<Details extends object>(record: OperationRecord<Details>, now: number): BuildOperation<Details> {
  const startedAtMs = record.startedAtMs
  const completedAtMs = record.completedAtMs ?? now
  return Object.freeze({
    operationId: record.operationId,
    details: record.details,
    state: record.state,
    phase: record.phase,
    queuedAt: new Date(record.queuedAtMs).toISOString(),
    startedAt: startedAtMs === null ? null : new Date(startedAtMs).toISOString(),
    queueDurationMs: Math.max(0, (startedAtMs ?? completedAtMs) - record.queuedAtMs),
    executionDurationMs: startedAtMs === null ? 0 : Math.max(0, completedAtMs - startedAtMs),
    resources: record.resources,
  })
}

/** Представляет честное отсутствие измерения, а не нулевую нагрузку. */
function emptyResourceSnapshot(): BuildResources {
  return Object.freeze({
    sampledAt: null,
    cpuPercent: null,
    rssBytes: null,
    descendantCount: 0,
    peakCpuPercent: null,
    peakRssBytes: null,
  })
}

/** Обновляет текущий sample и максимум только реально измеренных значений. */
function resourceSnapshot(
  previous: BuildResources,
  measured: MeasuredResources | null,
  sampledAt: string,
): BuildResources {
  if (measured === null) return previous
  return Object.freeze({
    sampledAt,
    ...measured,
    peakCpuPercent: measured.cpuPercent === null
      ? previous.peakCpuPercent
      : Math.max(previous.peakCpuPercent ?? measured.cpuPercent, measured.cpuPercent),
    peakRssBytes: measured.rssBytes === null
      ? previous.peakRssBytes
      : Math.max(previous.peakRssBytes ?? measured.rssBytes, measured.rssBytes),
  })
}

/** Отличает bounded timeout от обычной отмены и compiler failure. */
function isTimeoutOutcome(error: unknown, signal: AbortSignal): boolean {
  const value = signal.aborted ? signal.reason : error
  if (value instanceof DOMException && value.name === "TimeoutError") return true
  if (value instanceof Error && value.name === "TimeoutError") return true
  return false
}

/** Проверяет целочисленную настройку в закрытом диапазоне. */
function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid build ${name}: ${String(value)}`)
  }
  return value
}

/** Сохраняет переданную Error identity либо создаёт стандартный AbortError. */
function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new DOMException(reason === undefined ? "Build operation aborted" : String(reason), "AbortError")
}
