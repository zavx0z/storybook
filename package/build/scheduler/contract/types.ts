import type {ProcessMeasure} from "@process/measure"
import type ProcessResourceSampler from "@process/sample"

type StorybookBuildWorkerBinding = ProcessMeasure.Input["binding"]
type StorybookResourceSampler = Pick<InstanceType<typeof ProcessResourceSampler>, "sample">

export type StorybookBuildOwner = "open" | "check" | "subscribe" | "startup-validation" | "shared"
export type StorybookBuildReason =
  | "missing" | "explicit-build" | "input-changed" | "receipt-unverified" | "explicit-retry" | "toolchain-changed"

/** Фазы compiler/build, передаваемые package/shared worker. */
export type StorybookBuildWorkerPhase =
  | "verification"
  | "resources"
  | "exports"
  | "bundle"
  | "kernel"
  | "host"
  | "publish"

/** Публичная фаза scheduler, включая admission и discovery до compiler worker. */
export type StorybookBuildPhase = StorybookBuildWorkerPhase | "discovery" | "admission"

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
