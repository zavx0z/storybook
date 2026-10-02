import type {BuildProgress, CatalogProgress, SharedCacheProgress} from "./progress"
import type {PackageBuildState} from "./package"

export declare namespace WebStatus {
  /** Публичные проверки transport событий и тексты фактически наблюдаемых состояний. */
  export type Output = Readonly<{
    /** Возвращает проверенный scheduler transition либо null для неизвестной формы. */
    readBuild(value: unknown): BuildProgress | null
    /** Различает реальные границы catalog refresh. */
    readCatalog(value: unknown): CatalogProgress | null
    /** Принимает факт проверки shared cache без фиктивной scheduler job. */
    readSharedCache(value: unknown): SharedCacheProgress | null
    build(event: BuildProgress): string
    catalog(event: CatalogProgress): string
    sharedCache(event: SharedCacheProgress): string
    packageEvent(packageId: string, type: string): string
    packageBuild(packageId: string, state: PackageBuildState): string
    connection(state: "connecting" | "connected" | "reconnected" | "disconnected"): string
  }>
}
