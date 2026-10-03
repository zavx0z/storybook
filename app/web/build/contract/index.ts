import type {SharedBrowserAssets, SharedBrowserAssetsController, SharedBrowserAssetsInput} from "./assets"
import type {SharedBrowserBuildInput, SharedBrowserBuildOperationContext, SharedBrowserBuildPhaseListener} from "./build"
import type {PrepareInput, PreparedResult} from "./prepare"
import type {WebSources} from "./sources"
import type {WebAuthorStyleSheet} from "./theme"

/** Подготовка непрозрачного результата Web с точными версиями для публикации. */
export declare namespace AppWebBuild {
  /** Публичные операции подготовки, сохранения и публикации общей Web-оболочки. */
  export type Output = Readonly<{
    sources: WebSources
    prepare<Prepared, Version extends object>(input: PrepareInput<Prepared, Version>, signal: AbortSignal): Promise<PreparedResult<Prepared, Version>>
    Assets: new(options: SharedBrowserAssetsInput) => SharedBrowserAssetsController
    buildAssets(input: SharedBrowserBuildInput, onPhase?: SharedBrowserBuildPhaseListener): Promise<SharedBrowserAssets>
    runWorker(input: Omit<SharedBrowserBuildInput, "stagingDirectory">,
      context: SharedBrowserBuildOperationContext, workerPath?: string): Promise<SharedBrowserAssets>
    readPublishedReceipt(input: SharedBrowserBuildInput): SharedBrowserAssets | null
    saveCandidate(assets: SharedBrowserAssets): void
    readEpoch(root: string, epoch: string, hostEpoch?: string,
      onRejected?: (reason: string) => void): SharedBrowserAssets | null
    saveReceipt(assets: SharedBrowserAssets, current?: boolean): void
    readTheme(toolRoot: string): readonly WebAuthorStyleSheet[]
  }>
}
