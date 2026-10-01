import {type PackageBuildScheduler as PackageBuildSchedulerContract} from "@package-build/scheduler"
import type {BuildWorker} from "@build/worker"
type StorybookBuildScheduler = PackageBuildSchedulerContract.Output
type StorybookBuildCacheLayer = NonNullable<Parameters<PackageBuildSchedulerContract.Output["run"]>[0]["cache"]>["layer"]
type StorybookBuildCacheStatus = NonNullable<Parameters<PackageBuildSchedulerContract.Output["run"]>[0]["cache"]>["status"]
type StorybookBuildOutcome = ReturnType<PackageBuildSchedulerContract.Output["snapshot"]>["recent"][number]["outcome"]
type StorybookBuildOwner = Parameters<PackageBuildSchedulerContract.Output["run"]>[0]["owner"]
type StorybookBuildReason = Parameters<PackageBuildSchedulerContract.Output["run"]>[0]["reason"]
type TransportEvent = NonNullable<ReturnType<typeof import("@package-build/scheduler").default.parseStorybookBuildWorkerTransportEvent>>
type StorybookBuildPhaseListener = (event: Extract<TransportEvent, {kind: "phase"}>["event"]) => void
type StorybookBuildWorkerLifecycleListener = NonNullable<BuildWorker.Input<unknown, unknown>["onLifecycle"]>
import type {BuildInputs} from "@build/inputs"
type StorybookBuildInputFingerprint = BuildInputs.Output
import type {PackageRevision} from "@package/revision"
import type {PackageStandard} from "@package/standard"

export type StorybookPackageStandard = ReturnType<PackageStandard.Output["applied"]>
export type StorybookPackageVerification = NonNullable<Parameters<PackageStandard.Output["applied"]>[1]>

export type StorybookPackageScenarioSpec = Readonly<{
  nodeId: string
  sourcePaths: readonly string[]
}>
export type StorybookPackageRevisionResourceFile = Readonly<{
  sourcePath: string
  sourceRoot?: string
  targetPath: string
  contentDigest?: string
  /** Derived text, published only after attesting its exact source bytes. */
  derivedContent?: string
}>

export type StorybookPackageBuildDescriptor = Readonly<{
  packageId: string
  packageRoot: string
  projectRoot: string
  sourcePath: string
  declarationDigest: string
  graphSnapshot: ReturnType<PackageRevision.Output["create"]>
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
export type StorybookPackageInputFreshness = "unknown" | "verified" | "unverified" | "changed"

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
  inputFreshness?: StorybookPackageInputFreshness
}>

/**
Причина demand, передаваемая package queue в общий scheduler.

Owner обозначает источник решения строить, а reason — проверяемую причину miss;
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
  inputFingerprint?: StorybookBuildInputFingerprint
  verification?: StorybookPackageVerification
  warnings?: readonly StorybookPackageDiagnostic[]
}>

/**
Owner-provided проверка persisted fingerprint против текущего descriptor и bytes.

`null` означает любой unverifiable/mismatched случай и никогда не разрешает
выравнивать restored generation с текущей.
*/
export type StorybookPackageInputFingerprintVerifier = (
  value: unknown,
  descriptor: StorybookPackageBuildDescriptor,
) => StorybookBuildInputFingerprint | null

export type StorybookPackageRevisionBuilder = (input: Readonly<{
  descriptor: StorybookPackageBuildDescriptor
  generation: number
  candidateRevision: string
  revisionUrl: string
  stagingDirectory: string
  signal: AbortSignal
  compileTimeoutMs: number
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
  deadline: string
}>

export type StorybookPackageSessionOptions = Readonly<{
  artifactRoot: string
  buildRevision: StorybookPackageRevisionBuilder
  /** Подготавливает общие зависимости до занятия единственного compiler slot. */
  prepareBuild?(signal: AbortSignal): Promise<void>
  verifyInputFingerprint?: StorybookPackageInputFingerprintVerifier
  publish?(event: StorybookPackageEvent): void
  buildScheduler?: StorybookBuildScheduler
  compileTimeoutMs?: number
  activationTimeoutMs?: number
  retainedRevisionLimit?: number
}>
