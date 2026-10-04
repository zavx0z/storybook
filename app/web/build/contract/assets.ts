import type {StorybookTechBuildEnvironment} from "@zavx0z/storybook-tech-build-environment"
import type {StorybookPackageRevision} from "@zavx0z/storybook-package-revision"

/**
Готовые ресурсы общей оболочки.

@property root - Каталог immutable ресурсов; старые hashed файлы сохраняются для открытых страниц.

@property landingEntry - Относительный путь готового entry главной страницы.

@property fallbackEntry - Относительный путь entry страницы без применённой пакетной ревизии.


@property [artifactDigests] - SHA-256 опубликованных файлов; повреждение исключает восстановление receipt.

*/
export type SharedBrowserAssets = Readonly<{
  root: string
  landingEntry: string
  fallbackEntry: string
  bootstrapEntry?: string
  browserIdentity?: ReturnType<StorybookTechBuildEnvironment.Output["identity"]>
  artifactDigests?: readonly Readonly<{path: string, digest: string}>[]
  authorStyleSheets?: ReturnType<StorybookPackageRevision.Output["create"]>["workbenchAuthorStyleSheets"]
}>

/** Предоставленные сборка, сохранение и уведомления одного shared-ресурса. */
export type SharedBrowserAssetsInput = Readonly<{
  initial?: SharedBrowserAssets
  commit?(assets: SharedBrowserAssets): void
  build(signal: AbortSignal): Promise<SharedBrowserAssets>
  updated(assets: SharedBrowserAssets): void
  failed(error: unknown): void
}>

/** Жизненный цикл подготовленного и опубликованного shared-ресурса. */
export interface SharedBrowserAssetsController {
  current(): SharedBrowserAssets
  ensure(): Promise<SharedBrowserAssets>
  prepared(): SharedBrowserAssets | null
  stageHost(candidate: SharedBrowserAssets): void
  publish(expected?: SharedBrowserAssets | null): SharedBrowserAssets
  dispose(): Promise<void>
}
