import {type StorybookPackageBuildScheduler as PackageBuildSchedulerContract} from "@zavx0z/storybook-package-build-scheduler"
import type {StorybookTechBuildWorker} from "@zavx0z/storybook-tech-build-worker"
type StorybookBuildScheduler = PackageBuildSchedulerContract.Output
type StorybookBuildCacheLayer = NonNullable<Parameters<PackageBuildSchedulerContract.Output["run"]>[0]["cache"]>["layer"]
type StorybookBuildCacheStatus = NonNullable<Parameters<PackageBuildSchedulerContract.Output["run"]>[0]["cache"]>["status"]
type StorybookBuildOutcome = ReturnType<PackageBuildSchedulerContract.Output["snapshot"]>["recent"][number]["outcome"]
type StorybookBuildOwner = Parameters<PackageBuildSchedulerContract.Output["run"]>[0]["owner"]
type StorybookBuildReason = Parameters<PackageBuildSchedulerContract.Output["run"]>[0]["reason"]
type TransportEvent = NonNullable<ReturnType<typeof import("@zavx0z/storybook-package-build-scheduler").default.parseStorybookBuildWorkerTransportEvent>>
type StorybookBuildPhaseListener = (event: Extract<TransportEvent, {kind: "phase"}>["event"]) => void
type StorybookBuildWorkerLifecycleListener = NonNullable<StorybookTechBuildWorker.Input<unknown, unknown>["onLifecycle"]>
import type {StorybookPackageRevision} from "@zavx0z/storybook-package-revision"
import type {StorybookPackageStandard} from "@zavx0z/storybook-package-standard"

export type StorybookPackageStandard = ReturnType<StorybookPackageStandard.Output["applied"]>
export type StorybookPackageVerification = NonNullable<Parameters<StorybookPackageStandard.Output["applied"]>[1]>

export type StorybookPackageScenarioSpec = Readonly<{
  nodeId: string
  sourcePaths: readonly string[]
}>
export type StorybookPackageRevisionResourceFile = Readonly<{
  sourcePath: string
  sourceRoot?: string
  targetPath: string
  contentDigest?: string
  /** Готовый снимок производного текста с разрешённой принадлежностью sourceRoot/sourcePath. */
  derivedContent?: string
}>

/**
Входы одной сборки принадлежат компилируемому пакету и содержащему его Repo.

@property repo - Канонический корень Repo, задающего workspaces и общую среду компиляции.
Адрес Project не расширяет границу чтения пакета до других участвующих Repo.
*/
export type StorybookPackageBuildDescriptor = Readonly<{
  packageId: string
  packageRoot: string
  repo: string
  sourcePath: string
  declarationDigest: string
  graphSnapshot: ReturnType<StorybookPackageRevision.Output["create"]>
  resourceFiles?: readonly StorybookPackageRevisionResourceFile[]
  scenarioSpecs?: readonly StorybookPackageScenarioSpec[]
}>

export type StorybookPackageDiagnostic = Readonly<{
  phase: "resolve" | "validate" | "compile" | "link" | "protocol" | "publish" | "activation" | "timeout"
  message: string
  path: string | null
}>

export type StorybookPackageBuildState =
  | "idle" | "queued" | "compiling" | "building" | "built" | "activating" | "active" | "failed" | "disposed" | "ready"
export type StorybookPackageRevisionStatus = "built" | "activating" | "working" | "failed"

export type StorybookPackageRevisionSnapshot = Readonly<{
  revision: string
  generation: number
  status: StorybookPackageRevisionStatus
  declarationDigest: string
  packageGraphDigest: string
  moduleGraphRevision: string
  sharedModuleEpoch?: string
  entryRelativePath: string
  dependencyRealpaths: readonly string[]
  diagnostics: readonly StorybookPackageDiagnostic[]
  createdAt: string
  leases: number
}>

export type StorybookPackageSessionSnapshot = Readonly<{
  packageId: string
  declarationDigest: string
  moduleGraphRevision: string | null
  candidateRevision: string | null
  builtRevision?: string | null
  activatingRevision?: string | null
  activeRevision: string | null
  lastWorkingRevision?: string | null
  /** @deprecated Use lastWorkingRevision. */
  lastGoodRevision: string | null
  failedRevision?: string | null
  packageGraphDigest?: string
  generation?: number
  entryRelativePath: string | null
  diagnostics: readonly StorybookPackageDiagnostic[]
  warnings?: readonly StorybookPackageDiagnostic[]
  standard?: StorybookPackageStandard
  verification?: StorybookPackageVerification | null
  dependencyRealpaths: readonly string[]
  revisions?: readonly StorybookPackageRevisionSnapshot[]
  subscribers: number
  buildState: StorybookPackageBuildState
  builds: number
  requestedGeneration?: number
  completedGeneration?: number
  pendingOperationId?: string | null
  lastBuildReason?: StorybookBuildReason | null
  lastQueueDurationMs?: number | null
  lastExecutionDurationMs?: number | null
  lastBuildOutcome?: StorybookBuildOutcome | null
  cacheOutcome?: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}> | null
}>

/**
Причина demand, передаваемая package queue в общий scheduler.

Owner обозначает источник решения строить, а reason — причину заказа работы;
это не разрешение автоматически применять построенный candidate.
*/
export type StorybookPackageBuildDemand = Readonly<{
  owner: Exclude<StorybookBuildOwner, "shared">
  reason?: StorybookBuildReason
  cache?: Readonly<{status: StorybookBuildCacheStatus, layer: StorybookBuildCacheLayer}>
}>

export type StorybookPackageEvent =
  | Readonly<{type: "package.built", packageId: string, revision: string, graphDigest: string}>
  | Readonly<{type: "package.code-updated", packageId: string, path: string}>
  | Readonly<{type: "package.resources-updated", packageId: string, path: string}>
  | Readonly<{type: "package.metadata-updated", packageId: string, path: string}>
  | Readonly<{type: "package.activating", packageId: string, revision: string, activationId: string}>
  | Readonly<{type: "package.updated", packageId: string, revision: string}>
  | Readonly<{
    type: "package.failed"
    packageId: string
    revision?: string
    diagnostics: readonly StorybookPackageDiagnostic[]
  }>
  | Readonly<{type: "package.detached", packageId: string}>

export type StorybookPackageRevisionBuild = Readonly<{
  moduleGraphRevision: string
  sharedModuleEpoch?: string
  dependencyRealpaths: readonly string[]
  entryRelativePath: string
  verification?: StorybookPackageVerification
  warnings?: readonly StorybookPackageDiagnostic[]
}>

export type StorybookPackageRevisionBuilder = (input: Readonly<{
  descriptor: StorybookPackageBuildDescriptor
  generation: number
  candidateRevision: string
  revisionUrl: string
  stagingDirectory: string
  signal: AbortSignal
  standard?: StorybookPackageStandard
  onPhase?: StorybookBuildPhaseListener
  onWorkerLifecycle?: StorybookBuildWorkerLifecycleListener
}>) => Promise<StorybookPackageRevisionBuild>

export type StorybookPackageActivation = Readonly<{
  activationId: string
  packageId: string
  revision: string
  viewId: string
  route: string
  packageGraphDigest: string
  /** Общего срока нет, если вызывающий код не задал его явно. */
  deadline: string | null
}>

export type StorybookPackageSessionOptions = Readonly<{
  /** Предоставляет файловый дескриптор по запросу; полная проверка выполняется перед сборкой. */
  readDescriptor?(): StorybookPackageBuildDescriptor
  artifactRoot: string
  buildRevision: StorybookPackageRevisionBuilder
  /** Подготавливает общие зависимости до занятия единственного compiler slot. */
  prepareBuild?(signal: AbortSignal): Promise<void>
  publish?(event: StorybookPackageEvent): void
  buildScheduler?: StorybookBuildScheduler
  activationTimeoutMs?: number
  retainedRevisionLimit?: number
}>
