import {randomUUID} from "node:crypto"
import type {StorybookBuildPhase as StorybookCompilerBuildPhase} from "./build-phase.ts"
import BuildQueue, {type BuildContext, type BuildOperation, type BuildTransition} from "@build/queue"
import type {ProcessBinding as StorybookBuildWorkerBinding} from "@process/measure"
import type {ResourceSampler as StorybookResourceSampler} from "@process/sample"

/** Safe default оставляет этому 16 GiB Intel host одну тяжёлую build operation. */
export const STORYBOOK_BUILD_CONCURRENCY = 1
/** Верхняя граница явно настроенного admission, не автоматический host-derived default. */
export const STORYBOOK_BUILD_CONCURRENCY_MAX = 8
/** Число terminal operations, достаточное для bounded диагностики последних волн. */
export const STORYBOOK_BUILD_RECENT_LIMIT = 32
/** Минимальный интервал между системными process snapshots в миллисекундах. */
export const STORYBOOK_RESOURCE_SAMPLE_THROTTLE_MS = 1_000

export type StorybookBuildOwner = "open" | "check" | "subscribe" | "startup-validation" | "shared"
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

/** Сведения о пакетной работе остаются у сборочного координатора. */
type BuildDetails = Omit<ReturnType<typeof normalizeRequest>, "operationId">

/**
Связывает пакетную подготовку с технической очередью исполнения.

Координатор проверяет package/shared vocabulary и сохраняет прежнюю публичную
проекцию состояния. FIFO, владение slot и измерение worker принадлежат BuildQueue.
*/
export class StorybookBuildScheduler {
  readonly #queue: BuildQueue<BuildDetails>

  /** Создаёт одну очередь, общую для переданных ей пакетных и shared работ. */
  constructor(options: number | StorybookBuildSchedulerOptions = {}) {
    const normalized = typeof options === "number" ? {limit: options} : options
    this.#queue = new BuildQueue({...normalized, isTimeout: isTimeoutOutcome})
  }

  /** Число работ, удерживающих slot до завершения cleanup. */
  get active(): number { return this.#queue.active }

  /** Число работ, ещё ожидающих допуска. */
  get pending(): number { return this.#queue.pending }

  /** Проецирует технические переходы с идентичностью пакета и проверенной причиной работы. */
  subscribe(listener: StorybookBuildTransitionListener): () => void {
    if (typeof listener !== "function") throw new TypeError("Storybook build transition listener must be callable")
    return this.#queue.subscribe(event => listener(buildTransition(event)))
  }

  /** Сохраняет общий допуск и проверенный контекст существующих исполнителей. */
  run<Value>(operation: () => Promise<Value>, signal: AbortSignal): Promise<Value>
  run<Value>(request: StorybookBuildRequest, operation: (context: StorybookBuildOperationContext) => Promise<Value>, signal: AbortSignal): Promise<Value>
  async run<Value>(
    requestOrOperation: StorybookBuildRequest | (() => Promise<Value>),
    operationOrSignal: ((context: StorybookBuildOperationContext) => Promise<Value>) | AbortSignal,
    possibleSignal?: AbortSignal,
  ): Promise<Value> {
    const legacy = typeof requestOrOperation === "function"
    const {operationId, ...details} = normalizeRequest(legacy ? legacyBuildRequest() : requestOrOperation)
    const operation = legacy ? requestOrOperation : operationOrSignal as (context: StorybookBuildOperationContext) => Promise<Value>
    const signal = legacy ? operationOrSignal as AbortSignal : possibleSignal!
    if (typeof operation !== "function") throw new TypeError("Storybook build operation must be callable")
    return this.#queue.run({operationId, details}, async context => {
      let executing = true
      try { return await operation(buildContext(context, details, () => executing)) }
      finally { executing = false }
    }, signal)
  }

  /** Предоставляет прежний низкоуровневый допуск через ту же техническую очередь. */
  async acquire(signal: AbortSignal): Promise<() => void> {
    const {operationId, ...details} = normalizeRequest(legacyBuildRequest())
    const admission = await this.#queue.acquire({operationId, details}, signal)
    return () => admission.finish(signal.aborted ? "canceled" : "completed")
  }

  /** Читает состояние без compiler demand; измерения включаются только явным параметром. */
  snapshot(options: Readonly<{sampleResources?: boolean}> = {}): StorybookBuildSchedulerSnapshot {
    const snapshot = this.#queue.snapshot(options)
    const active = Object.freeze(snapshot.active.map(buildOperation))
    return Object.freeze({
      ...snapshot,
      sharedBuildActive: active.some(({owner}) => owner === "shared"),
      active,
      queued: Object.freeze(snapshot.queued.map(buildOperation)),
      recent: Object.freeze(snapshot.recent.map(({state: _state, outcome, completedAt, ...operation}) => Object.freeze({
        ...buildOperation({...operation, state: "running"}), state: "completed" as const, outcome, completedAt,
      }))),
    })
  }

  /** Закрывает очередь ожидания; запущенные исполнители завершают свои ресурсы. */
  dispose(): void { this.#queue.dispose() }
}

/** Передаёт исполнителю технический lifecycle с проверкой предметных этапов и кэша. */
function buildContext(context: BuildContext<BuildDetails>, initial: BuildDetails, executing: () => boolean): StorybookBuildOperationContext {
  let details = initial
  return Object.freeze({
    operationId: context.operationId,
    signal: context.signal,
    queuedAt: context.queuedAt,
    startedAt: context.startedAt,
    setPhase: (phase: StorybookBuildPhase) => { if (executing()) context.setPhase(normalizePhase(phase)) },
    bindWorker: context.bindWorker,
    clearWorker: context.clearWorker,
    setCacheOutcome: (cache: Readonly<{status: StorybookBuildCacheStatus; layer: StorybookBuildCacheLayer}>) => {
      if (!executing()) return
      const normalized = normalizeRequest({...details, operationId: context.operationId, cache})
      const {operationId: _id, ...next} = normalized
      details = next
      context.setDetails(next)
    },
  })
}

/** Сохраняет существующий плоский контракт status без технического контейнера details. */
function buildOperation(operation: BuildOperation<BuildDetails>): StorybookBuildOperationSnapshot {
  const {details, phase, ...snapshot} = operation
  return Object.freeze({...snapshot, ...details, phase: phase as StorybookBuildPhase})
}

/** Сохраняет terminal discrimination и immutable payload браузерного прогресса. */
function buildTransition(event: BuildTransition<BuildDetails>): StorybookBuildTransition {
  const {details, phase, ...transition} = event
  return Object.freeze({...transition, ...details, phase: phase as StorybookBuildPhase})
}

/** Проверяет runtime request и сохраняет собственный immutable снимок допустимых полей кэша. */
function normalizeRequest(request: StorybookBuildRequest) {
  if (request === null || typeof request !== "object") throw new TypeError("Storybook build request must be an object")
  const operationId = request.operationId ?? randomUUID()
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(operationId)) throw new Error(`Invalid Storybook build operation id: ${operationId}`)
  if (request.packageId !== null && (typeof request.packageId !== "string" || request.packageId.trim().length === 0)) {
    throw new Error(`Invalid Storybook build package id: ${String(request.packageId)}`)
  }
  if (!["open", "check", "subscribe", "startup-validation", "shared"].includes(request.owner)) {
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
  const {status, layer} = request.cache ?? {status: "unknown" as const, layer: request.owner === "shared" ? "shared" as const : "package" as const}
  if (!["hit", "miss", "bypass", "unknown"].includes(status) ||
    !["receipt", "protocol", "package", "shared"].includes(layer)) {
    throw new Error("Invalid Storybook build cache outcome")
  }
  return Object.freeze({
    operationId,
    packageId: request.packageId,
    owner: request.owner,
    reason: request.reason,
    generation: request.generation,
    cache: Object.freeze({status, layer}),
  })
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
    "verification",
    "resources",
    "exports",
    "bundle",
    "kernel",
    "host",
    "publish",
  ].includes(phase)) {
    throw new Error(`Invalid Storybook build phase: ${String(phase)}`)
  }
  return phase
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
