import type {Zavx0zStorybookPackageRevision} from "@zavx0z/storybook-package-revision"
import type {
  Zavx0zStorybookPackageActivation,
  StorybookPackageBuildDemand,
  Zavx0zStorybookPackageBuildDescriptor,
  StorybookPackageDiagnostic,
  StorybookPackageSessionOptions,
  StorybookPackageSessionSnapshot,
} from "./types"

/** Публичный контракт одного независимо обновляемого пакета. */
export declare namespace Zavx0zStorybookPackageSession {
  /** Дескриптор пакета и предоставленные возможности подготовки ревизии. */
  export type Input = [descriptor: Zavx0zStorybookPackageBuildDescriptor, options: StorybookPackageSessionOptions]

  /** Управление одним пакетом, его ревизиями, проверками и lease. */
  export interface Output {
    readonly packageId: string
    readonly descriptor: Zavx0zStorybookPackageBuildDescriptor
    setResolutionError(message: string | null): void
    reconfigure(descriptor: Zavx0zStorybookPackageBuildDescriptor): boolean
    snapshot(): StorybookPackageSessionSnapshot
    subscribe(): () => void
    /** Явная пересборка. Одновременные запросы разделяют уже исполняемый заказ. */
    build(demand?: StorybookPackageBuildDemand): Promise<StorybookPackageSessionSnapshot>
    retryFailed(): boolean
    /** Открытие использует готовую ревизию; при её отсутствии заказывает подготовку. */
    ensureBuilt(demand?: StorybookPackageBuildDemand): Promise<StorybookPackageSessionSnapshot>
    beginActivation(input: Readonly<{revision: string, viewId: string, route: string, timeoutMs?: number}>): Zavx0zStorybookPackageActivation
    acknowledgeActivation(input: Readonly<{
      revision: string
      activationId: string
      viewId: string
      route: string
      packageGraphDigest: string
      frameSequence: number
    }>): StorybookPackageSessionSnapshot
    failActivation(input: Readonly<{
      revision: string
      activationId: string
      diagnostic: StorybookPackageDiagnostic | readonly StorybookPackageDiagnostic[]
    }>): StorybookPackageSessionSnapshot
    acquireRevisionLease(revision: string, leaseId?: string): Readonly<{leaseId: string, revision: string, release(): void}>
    revisionGraphSnapshot(revision: string): ReturnType<Zavx0zStorybookPackageRevision.Output["create"]> | null
    revisionDirectory(revision?: string | null): string | null
    dispose(): Promise<void>
  }
}
