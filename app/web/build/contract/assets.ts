import type {BuildInputs} from "@build/inputs"
import type {BuildEnvironment} from "@build/environment"
import type {PackageRevision} from "@package/revision"

/**
Готовые ресурсы общей оболочки и свидетельство их исходников.

@property root - Каталог immutable ресурсов; старые hashed файлы сохраняются для открытых страниц.

@property landingEntry - Относительный путь готового entry главной страницы.

@property fallbackEntry - Относительный путь entry страницы без применённой пакетной ревизии.

@property dependencyRealpaths - Канонические зависимости browser metafile.

@property [inputFingerprint] - Полные проверенные входы, включая config и ambient declarations.

@property [artifactDigests] - SHA-256 опубликованных файлов; повреждение исключает восстановление receipt.

@property [cacheHit] - Worker восстановил готовые ресурсы без запуска Bun.build.
*/
export type SharedBrowserAssets = Readonly<{
  root: string
  landingEntry: string
  fallbackEntry: string
  bootstrapEntry?: string
  compatibleHosts?: readonly Readonly<{sharedModuleEpoch: string, hostModuleEpoch: string}>[]
  browserIdentity?: ReturnType<BuildEnvironment.Output["identity"]>
  dependencyRealpaths: readonly string[]
  inputFingerprint?: BuildInputs.Output
  artifactDigests?: readonly Readonly<{path: string, digest: string}>[]
  cacheHit?: boolean
  authorStyleSheets?: ReturnType<PackageRevision.Output["create"]>["workbenchAuthorStyleSheets"]
}>

/** Предоставленные сборка, сохранение и уведомления одного shared-ресурса. */
export type SharedBrowserAssetsInput = Readonly<{
  initial?: SharedBrowserAssets
  commit?(assets: SharedBrowserAssets): void
  build(signal: AbortSignal): Promise<SharedBrowserAssets>
  updated(assets: SharedBrowserAssets): void
  failed(error: unknown): void
  cacheProgress?(event: Readonly<{state: "started" | "completed", hit?: boolean}>): void
}>

/** Жизненный цикл подготовленного и опубликованного shared-ресурса. */
export interface SharedBrowserAssetsController {
  current(): SharedBrowserAssets
  ensure(): Promise<SharedBrowserAssets>
  prepared(): SharedBrowserAssets | null
  stageHost(candidate: SharedBrowserAssets): void
  publish(variants?: readonly SharedBrowserAssets[], expected?: SharedBrowserAssets | null): SharedBrowserAssets
  dispose(): Promise<void>
}
