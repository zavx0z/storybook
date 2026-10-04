/**
Соединяет пакетные причины сборки с общей очередью исполнения.
Допуск, отмена, фазы и ограниченная история доступны из одного жизненного цикла.

@packageDocumentation
*/
import {randomUUID} from "node:crypto"
import StorybookTechBuildQueue from "@storybook-tech-build/queue"
import {
  STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL,
  parseStorybookBuildWorkerTransportEvent,
  isStorybookBuildPhase,
} from "./src/phase"
import type {
  StorybookBuildCacheLayer,
  StorybookBuildCacheStatus,
  StorybookBuildOperationContext,
  StorybookBuildOperationSnapshot,
  StorybookBuildPhase,
  StorybookBuildRequest,
  StorybookBuildSchedulerOptions,
  StorybookBuildSchedulerSnapshot,
  StorybookBuildTransition,
  StorybookBuildTransitionListener,
} from "./contract/types"
import type {StorybookPackageBuildScheduler} from "./contract"

export type {StorybookPackageBuildScheduler} from "./contract"

/** Safe default оставляет этому 16 GiB Intel host одну тяжёлую build operation. */
const STORYBOOK_BUILD_CONCURRENCY = 1
/** Верхняя граница явно настроенного admission, не автоматический host-derived default. */
const STORYBOOK_BUILD_CONCURRENCY_MAX = 8
/** Число terminal operations, достаточное для bounded диагностики последних волн. */
const STORYBOOK_BUILD_RECENT_LIMIT = 32
/** Минимальный интервал между системными process snapshots в миллисекундах. */
const STORYBOOK_RESOURCE_SAMPLE_THROTTLE_MS = 1_000

/** Сведения о пакетной работе остаются у сборочного координатора. */
type BuildDetails = Omit<ReturnType<typeof normalizeRequest>, "operationId">
type BuildContext<Details extends object> = Parameters<Parameters<StorybookTechBuildQueue<Details>["run"]>[1]>[0]
type BuildOperation<Details extends object> = ReturnType<StorybookTechBuildQueue<Details>["snapshot"]>["active"][number]
type BuildTransition<Details extends object> = Parameters<Parameters<StorybookTechBuildQueue<Details>["subscribe"]>[0]>[0]

/**
Связывает пакетную подготовку с технической очередью исполнения.

Координатор проверяет package/shared vocabulary и сохраняет прежнюю публичную
проекцию состояния. FIFO, владение slot и измерение worker принадлежат StorybookTechBuildQueue.
*/
export default class StorybookBuildScheduler implements StorybookPackageBuildScheduler.Output {
  static readonly STORYBOOK_BUILD_CONCURRENCY = STORYBOOK_BUILD_CONCURRENCY
  static readonly STORYBOOK_BUILD_CONCURRENCY_MAX = STORYBOOK_BUILD_CONCURRENCY_MAX
  static readonly STORYBOOK_BUILD_RECENT_LIMIT = STORYBOOK_BUILD_RECENT_LIMIT
  static readonly STORYBOOK_RESOURCE_SAMPLE_THROTTLE_MS = STORYBOOK_RESOURCE_SAMPLE_THROTTLE_MS
  static readonly STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL = STORYBOOK_BUILD_WORKER_EVENT_PROTOCOL
  static readonly parseStorybookBuildWorkerTransportEvent = parseStorybookBuildWorkerTransportEvent
  readonly #queue: StorybookTechBuildQueue<BuildDetails>

  /** Создаёт одну очередь, общую для переданных ей пакетных и shared работ. */
  constructor(options: number | StorybookBuildSchedulerOptions = {}) {
    const normalized = typeof options === "number" ? {limit: options} : options
    this.#queue = new StorybookTechBuildQueue({...normalized, isTimeout: isTimeoutOutcome})
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
  if (!["missing", "explicit-build", "input-changed", "receipt-unverified", "explicit-retry", "toolchain-changed"].includes(request.reason)) {
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
  if (phase !== "discovery" && phase !== "admission" && !isStorybookBuildPhase(phase)) {
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
