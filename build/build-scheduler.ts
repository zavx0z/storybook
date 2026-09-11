import {randomUUID} from "node:crypto"
import type {StorybookBuildPhase as StorybookCompilerBuildPhase} from "./build-phase.ts"
import {
  StorybookProcessResourceSampler,
  measureStorybookWorkerResources,
  type StorybookBuildWorkerBinding,
  type StorybookMeasuredResources,
  type StorybookResourceSampler,
} from "./resource-usage.ts"

/** Safe default оставляет этому 16 GiB Intel host одну тяжёлую build operation. */
export const STORYBOOK_BUILD_CONCURRENCY = 1
/** Верхняя граница явно настроенного admission, не автоматический host-derived default. */
export const STORYBOOK_BUILD_CONCURRENCY_MAX = 8
/** Число terminal operations, достаточное для bounded диагностики последних волн. */
export const STORYBOOK_BUILD_RECENT_LIMIT = 32
/** Минимальный интервал между системными process snapshots в миллисекундах. */
export const STORYBOOK_RESOURCE_SAMPLE_THROTTLE_MS = 1_000

export type StorybookBuildOwner = "open" | "check" | "watch" | "subscribe" | "startup-validation" | "shared"
export type StorybookBuildReason =
  | "missing" | "input-changed" | "receipt-unverified" | "explicit-retry" | "toolchain-changed"
export type StorybookBuildPhase = StorybookCompilerBuildPhase | "discovery" | "admission" | "publish"
export type StorybookBuildCacheStatus = "hit" | "miss" | "bypass" | "unknown"
export type StorybookBuildCacheLayer = "receipt" | "protocol" | "package" | "shared"
export type StorybookBuildOutcome = "completed" | "failed" | "canceled" | "timed-out"

/**
Минимальное push-событие для информационной панели без process identity.

Terminal event единственный содержит `outcome`; ресурсы остаются в throttled
read-only snapshot и не сэмплируются ради transition.
*/
export type StorybookBuildTransition = Readonly<{
  at: string
  operationId: string
  packageId: string | null
  generation: number | null
  owner: StorybookBuildOwner
  state: StorybookBuildOperationState
  reason?: StorybookBuildReason
  cache?: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}>
  phase: StorybookBuildPhase
  outcome?: never
}> | Readonly<{
  at: string
  operationId: string
  packageId: string | null
  generation: number | null
  owner: StorybookBuildOwner
  state: "completed"
  reason?: StorybookBuildReason
  cache?: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}>
  phase: StorybookBuildPhase
  outcome: StorybookBuildOutcome
}>

/** Получает переходы scheduler; ошибка listener не влияет на build lifecycle. */
export type StorybookBuildTransitionListener = (transition: StorybookBuildTransition) => void

/**
Identity и причина одной работы до admission.

@property operationId - Opaque identity, пригодная для связи package snapshot
с global scheduler snapshot; PID и filesystem identity в неё не входят.

@property packageId - Точный package owner либо `null` только для shared build.

@property generation - Package generation либо `null` для shared build.
*/
export type StorybookBuildRequest = Readonly<{
  operationId?: string
  packageId: string | null
  owner: StorybookBuildOwner
  reason: StorybookBuildReason
  generation: number | null
  cache?: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}>
}>

/**
Измеренная нагрузка operation без private process identity.

Peak-поля — максимум только среди реально наблюдённых samples, а не обещание
истинного process peak. Они остаются `null` до первого измерения.
*/
export type StorybookBuildResourceSnapshot = Readonly<{
  sampledAt: string | null
  cpuPercent: number | null
  rssBytes: number | null
  descendantCount: number
  peakCpuPercent: number | null
  peakRssBytes: number | null
}>

/** Состояние admission; `canceling` всё ещё занимает slot до exact cleanup. */
export type StorybookBuildOperationState = "queued" | "running" | "canceling"

/** Read-only projection ожидающей или исполняемой scheduler operation. */
export type StorybookBuildOperationSnapshot = Readonly<{
  operationId: string
  packageId: string | null
  owner: StorybookBuildOwner
  reason: StorybookBuildReason
  generation: number | null
  state: StorybookBuildOperationState
  phase: StorybookBuildPhase
  queuedAt: string
  startedAt: string | null
  queueDurationMs: number
  executionDurationMs: number
  cache: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}>
  resources: StorybookBuildResourceSnapshot
}>

/** Bounded terminal record, сохраняющий точные queue/run durations и outcome. */
export type StorybookBuildCompletionSnapshot = Omit<StorybookBuildOperationSnapshot, "state"> & Readonly<{
  state: "completed"
  outcome: StorybookBuildOutcome
  completedAt: string
}>

/** Один согласованный read-only snapshot admission, execution и recent history. */
export type StorybookBuildSchedulerSnapshot = Readonly<{
  sampledAt: string
  limit: number
  activeCount: number
  queuedCount: number
  sharedBuildActive: boolean
  active: readonly StorybookBuildOperationSnapshot[]
  queued: readonly StorybookBuildOperationSnapshot[]
  recent: readonly StorybookBuildCompletionSnapshot[]
}>

/**
Hooks exact operation после admission.

Worker binding сообщает только identity уже созданного worker. Scheduler может
измерять его дерево, но никогда не посылает process signals и не завершает его.
*/
export type StorybookBuildOperationContext = Readonly<{
  operationId: string
  signal: AbortSignal
  queuedAt: string
  startedAt: string
  setPhase(phase: StorybookBuildPhase): void
  bindWorker(binding: StorybookBuildWorkerBinding): () => void
  clearWorker(): void
  setCacheOutcome?(cache: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}>): void
}>

/**
Настройка одного scheduler lifecycle.

@property limit - Число одновременных тяжёлых jobs в диапазоне `1..8`.

@property recentLimit - Размер terminal ring в диапазоне `0..256`.

@property resourceSampleThrottleMs - Минимальный интервал process snapshots
в миллисекундах; значение меньше секунды отклоняется.
*/
export type StorybookBuildSchedulerOptions = Readonly<{
  limit?: number
  recentLimit?: number
  resourceSampleThrottleMs?: number
  resourceSampler?: StorybookResourceSampler
  now?: () => number
}>

type OperationRecord = {
  operationId: string
  packageId: string | null
  owner: StorybookBuildOwner
  reason: StorybookBuildReason
  generation: number | null
  cache: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}>
  signal: AbortSignal
  state: StorybookBuildOperationState
  phase: StorybookBuildPhase
  queuedAtMs: number
  startedAtMs: number | null
  completedAtMs: number | null
  worker: StorybookBuildWorkerBinding | null
  resources: StorybookBuildResourceSnapshot
  resolve(admission: Admission): void
  reject(error: unknown): void
  onAbort(): void
}

type Admission = Readonly<{
  context: StorybookBuildOperationContext
  finish(outcome: StorybookBuildOutcome): void
}>

/**
Общий bounded scheduler тяжёлых package/shared jobs.

Очередь FIFO сохраняет прежнюю семантику semaphore. Отмена queued operation не
занимает CPU slot; отмена running operation лишь фиксирует `canceling` и ждёт,
пока exact owner завершит свой child lifecycle через переданный `AbortSignal`.
*/
export class StorybookBuildScheduler {
  readonly #limit: number
  readonly #recentLimit: number
  readonly #resourceSampleThrottleMs: number
  readonly #resourceSampler: StorybookResourceSampler
  readonly #now: () => number
  readonly #pending: OperationRecord[] = []
  readonly #active = new Map<string, OperationRecord>()
  readonly #recent: StorybookBuildCompletionSnapshot[] = []
  readonly #listeners = new Set<StorybookBuildTransitionListener>()
  #lastResourceSampleMs = Number.NEGATIVE_INFINITY
  #disposed = false

  constructor(options: number | StorybookBuildSchedulerOptions = {}) {
    const normalized = typeof options === "number" ? {limit: options} : options
    this.#limit = boundedInteger(
      normalized.limit ?? STORYBOOK_BUILD_CONCURRENCY,
      1,
      STORYBOOK_BUILD_CONCURRENCY_MAX,
      "build concurrency",
    )
    this.#recentLimit = boundedInteger(normalized.recentLimit ?? STORYBOOK_BUILD_RECENT_LIMIT, 0, 256, "recent build limit")
    this.#resourceSampleThrottleMs = boundedInteger(
      normalized.resourceSampleThrottleMs ?? STORYBOOK_RESOURCE_SAMPLE_THROTTLE_MS,
      STORYBOOK_RESOURCE_SAMPLE_THROTTLE_MS,
      60_000,
      "resource sample throttle",
    )
    this.#resourceSampler = normalized.resourceSampler ?? new StorybookProcessResourceSampler()
    this.#now = normalized.now ?? Date.now
  }

  get active(): number {
    return this.#active.size
  }

  get pending(): number {
    return this.#pending.length
  }

  /**
  Подписывает информационного потребителя на будущие operation transitions.

  Текущее состояние не воспроизводится: для начального baseline владелец читает
  {@link snapshot}. Возвращённая отмена подписки идемпотентна.
  */
  subscribe(listener: StorybookBuildTransitionListener): () => void {
    if (typeof listener !== "function") throw new TypeError("Storybook build transition listener must be callable")
    if (this.#disposed) throw new Error("Storybook build scheduler is disposed")
    this.#listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.#listeners.delete(listener)
    }
  }

  /**
  Исполняет operation после общего FIFO admission и всегда освобождает slot.

  Legacy overload без request сохраняется для прежнего semaphore API; новые
  владельцы передают request и получают exact context.
  */
  run<Value>(operation: () => Promise<Value>, signal: AbortSignal): Promise<Value>
  run<Value>(
    request: StorybookBuildRequest,
    operation: (context: StorybookBuildOperationContext) => Promise<Value>,
    signal: AbortSignal,
  ): Promise<Value>
  async run<Value>(
    requestOrOperation: StorybookBuildRequest | (() => Promise<Value>),
    operationOrSignal: ((context: StorybookBuildOperationContext) => Promise<Value>) | AbortSignal,
    possibleSignal?: AbortSignal,
  ): Promise<Value> {
    const legacy = typeof requestOrOperation === "function"
    const request = legacy ? legacyBuildRequest() : requestOrOperation
    const operation = legacy
      ? requestOrOperation
      : operationOrSignal as (context: StorybookBuildOperationContext) => Promise<Value>
    const signal = legacy ? operationOrSignal as AbortSignal : possibleSignal!
    if (typeof operation !== "function") throw new TypeError("Storybook build operation must be callable")
    const admission = await this.#acquire(request, signal)
    let outcome: StorybookBuildOutcome = "failed"
    try {
      signal.throwIfAborted()
      const value = await operation(admission.context)
      if (signal.aborted) throw abortError(signal.reason)
      outcome = "completed"
      return value
    } catch (error) {
      outcome = isTimeoutOutcome(error, signal) ? "timed-out" : signal.aborted ? "canceled" : "failed"
      throw error
    } finally {
      admission.finish(outcome)
    }
  }

  /**
  Совместимый низкоуровневый admission без task payload.

  Новые package/shared владельцы используют {@link run}, чтобы snapshot содержал
  причину и generation. Повторный `release` безопасен.
  */
  async acquire(signal: AbortSignal): Promise<() => void> {
    const admission = await this.#acquire(legacyBuildRequest(), signal)
    return () => admission.finish(signal.aborted ? "canceled" : "completed")
  }

  /**
  Возвращает согласованный snapshot и опционально обновляет реальные resources.

  Сэмплирование выполняется не чаще throttle и только этим read-only вызовом.
  Оно никогда не запускает compiler job и не меняет admission.
  */
  snapshot(options: Readonly<{sampleResources?: boolean}> = {}): StorybookBuildSchedulerSnapshot {
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
      sharedBuildActive: active.some(({owner}) => owner === "shared"),
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
      record.reject(new Error("Storybook build scheduler is disposed"))
    }
    this.#listeners.clear()
  }

  #acquire(request: StorybookBuildRequest, signal: AbortSignal): Promise<Admission> {
    if (this.#disposed) return Promise.reject(new Error("Storybook build scheduler is disposed"))
    if (!(signal instanceof AbortSignal)) return Promise.reject(new TypeError("Storybook build signal is invalid"))
    if (signal.aborted) return Promise.reject(abortError(signal.reason))
    const normalized = normalizeRequest(request)
    if (this.#pending.some(({operationId}) => operationId === normalized.operationId) ||
      this.#active.has(normalized.operationId) ||
      this.#recent.some(({operationId}) => operationId === normalized.operationId)) {
      return Promise.reject(new Error(`Duplicate Storybook build operation id: ${normalized.operationId}`))
    }
    return new Promise<Admission>((resolvePromise, reject) => {
      const record: OperationRecord = {
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
          this.#finish(record, isTimeoutOutcome(signal.reason, signal) ? "timed-out" : "canceled")
          reject(abortError(signal.reason))
        },
      }
      signal.addEventListener("abort", record.onAbort, {once: true})
      this.#pending.push(record)
      this.#publishTransition(record)
      this.#drain()
    })
  }

  #admit(record: OperationRecord): Admission {
    record.startedAtMs = this.#now()
    record.state = "running"
    this.#active.set(record.operationId, record)
    this.#publishTransition(record)
    const context: StorybookBuildOperationContext = Object.freeze({
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
      setCacheOutcome: cache => {
        if (record.completedAtMs !== null) return
        if (!["hit", "miss", "bypass", "unknown"].includes(cache.status) ||
          !["receipt", "protocol", "package", "shared"].includes(cache.layer)) {
          throw new Error("Invalid Storybook build cache outcome")
        }
        record.cache = Object.freeze({...cache})
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

  #finish(record: OperationRecord, outcome: StorybookBuildOutcome): void {
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

  #drain(): void {
    while (!this.#disposed && this.#active.size < this.#limit && this.#pending.length > 0) {
      const record = this.#pending.shift()!
      if (record.signal.aborted) {
        this.#finish(record, isTimeoutOutcome(record.signal.reason, record.signal) ? "timed-out" : "canceled")
        record.reject(abortError(record.signal.reason))
        continue
      }
      record.resolve(this.#admit(record))
    }
  }

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
      const measured = measureStorybookWorkerResources(record.worker!, rows)
      record.resources = resourceSnapshot(record.resources, measured, sampledAt)
    }
  }

  /** Публикует immutable transition, изолируя ошибки информационных listeners. */
  #publishTransition(record: OperationRecord, outcome?: StorybookBuildOutcome): void {
    const transition: StorybookBuildTransition = outcome === undefined
      ? Object.freeze({
        at: new Date(this.#now()).toISOString(),
        operationId: record.operationId,
        packageId: record.packageId,
        generation: record.generation,
        owner: record.owner,
        reason: record.reason,
        cache: record.cache,
        state: record.state,
        phase: record.phase,
      })
      : Object.freeze({
        at: new Date(record.completedAtMs ?? this.#now()).toISOString(),
        operationId: record.operationId,
        packageId: record.packageId,
        generation: record.generation,
        owner: record.owner,
        reason: record.reason,
        cache: record.cache,
        state: "completed",
        phase: record.phase,
        outcome,
      })
    for (const listener of this.#listeners) {
      try {
        listener(transition)
      } catch (error) {
        console.error(`Storybook build transition publication failed for ${record.operationId}`, error)
      }
    }
  }
}

/** Проверяет runtime request до помещения в очередь. */
function normalizeRequest(request: StorybookBuildRequest) {
  if (request === null || typeof request !== "object") throw new TypeError("Storybook build request must be an object")
  const operationId = request.operationId ?? randomUUID()
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(operationId)) throw new Error(`Invalid Storybook build operation id: ${operationId}`)
  if (request.packageId !== null && (typeof request.packageId !== "string" || request.packageId.trim().length === 0)) {
    throw new Error(`Invalid Storybook build package id: ${String(request.packageId)}`)
  }
  if (!["open", "check", "watch", "subscribe", "startup-validation", "shared"].includes(request.owner)) {
    throw new Error(`Invalid Storybook build owner: ${String(request.owner)}`)
  }
  if (!["missing", "input-changed", "receipt-unverified", "explicit-retry", "toolchain-changed"].includes(request.reason)) {
    throw new Error(`Invalid Storybook build reason: ${String(request.reason)}`)
  }
  if (request.owner === "shared" && request.packageId !== null) throw new Error("Shared build cannot own a package id")
  if (request.owner !== "shared" && request.packageId === null && request.owner !== "startup-validation") {
    throw new Error(`Storybook ${request.owner} build requires a package id`)
  }
  if (request.generation !== null && (!Number.isSafeInteger(request.generation) || request.generation < 0)) {
    throw new Error(`Invalid Storybook build generation: ${String(request.generation)}`)
  }
  const cache = request.cache ?? Object.freeze({status: "unknown" as const, layer: request.owner === "shared" ? "shared" as const : "package" as const})
  if (!["hit", "miss", "bypass", "unknown"].includes(cache.status) ||
    !["receipt", "protocol", "package", "shared"].includes(cache.layer)) {
    throw new Error("Invalid Storybook build cache outcome")
  }
  return Object.freeze({...request, operationId, cache})
}

/** Создаёт neutral identity для совместимого низкоуровневого semaphore вызова. */
function legacyBuildRequest(): StorybookBuildRequest {
  return Object.freeze({
    packageId: null,
    owner: "startup-validation",
    reason: "missing",
    generation: null,
    cache: Object.freeze({status: "unknown", layer: "package"}),
  })
}

/** Отклоняет phase за пределами общего compiler/scheduler vocabulary. */
function normalizePhase(phase: StorybookBuildPhase): StorybookBuildPhase {
  if (![
    "discovery",
    "admission",
    "cache",
    "fingerprint",
    "resources",
    "exports",
    "bundle",
    "kernel",
    "host",
    "protocol-build",
    "protocol-run",
    "publish",
  ].includes(phase)) {
    throw new Error(`Invalid Storybook build phase: ${String(phase)}`)
  }
  return phase
}

/** Проверяет private process binding без чтения либо управления процессом. */
function normalizeWorkerBinding(binding: StorybookBuildWorkerBinding): StorybookBuildWorkerBinding {
  if (binding === null || typeof binding !== "object" || !Number.isSafeInteger(binding.pid) || binding.pid < 1) {
    throw new Error(`Invalid Storybook build worker PID: ${String(binding?.pid)}`)
  }
  if (binding.startedAt !== undefined && !Number.isFinite(Date.parse(binding.startedAt))) {
    throw new Error(`Invalid Storybook build worker start: ${binding.startedAt}`)
  }
  return Object.freeze({...binding})
}

/** Проецирует record, вычисляя duration относительно одного согласованного времени. */
function operationSnapshot(record: OperationRecord, now: number): StorybookBuildOperationSnapshot {
  const startedAtMs = record.startedAtMs
  const completedAtMs = record.completedAtMs ?? now
  return Object.freeze({
    operationId: record.operationId,
    packageId: record.packageId,
    owner: record.owner,
    reason: record.reason,
    generation: record.generation,
    state: record.state,
    phase: record.phase,
    queuedAt: new Date(record.queuedAtMs).toISOString(),
    startedAt: startedAtMs === null ? null : new Date(startedAtMs).toISOString(),
    queueDurationMs: Math.max(0, (startedAtMs ?? completedAtMs) - record.queuedAtMs),
    executionDurationMs: startedAtMs === null ? 0 : Math.max(0, completedAtMs - startedAtMs),
    cache: record.cache,
    resources: record.resources,
  })
}

/** Представляет честное отсутствие измерения, а не нулевую нагрузку. */
function emptyResourceSnapshot(): StorybookBuildResourceSnapshot {
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
  previous: StorybookBuildResourceSnapshot,
  measured: StorybookMeasuredResources | null,
  sampledAt: string,
): StorybookBuildResourceSnapshot {
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
  if (value !== null && typeof value === "object" && "storybookDiagnostics" in value) {
    const diagnostics = (value as {storybookDiagnostics?: readonly {phase?: string}[]}).storybookDiagnostics
    return diagnostics?.some(({phase}) => phase === "timeout") ?? false
  }
  return false
}

/** Проверяет целочисленную настройку в закрытом диапазоне. */
function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid Storybook ${name}: ${String(value)}`)
  }
  return value
}

/** Сохраняет переданную Error identity либо создаёт стандартный AbortError. */
function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new DOMException(reason === undefined ? "Storybook operation aborted" : String(reason), "AbortError")
}
