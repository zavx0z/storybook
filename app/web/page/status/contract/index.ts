import type {BuildProgress, CatalogProgress} from "./progress"
import type {PackageBuildState} from "./package"

export declare namespace WebStatus {
  /** Публичные проверки transport событий и тексты фактически наблюдаемых состояний. */
  export type Output = Readonly<{
    /** Возвращает проверенный scheduler transition либо null для неизвестной формы. */
    readBuild(value: unknown): BuildProgress | null
    /** Различает реальные границы catalog refresh. */
    readCatalog(value: unknown): CatalogProgress | null
    build(event: BuildProgress): string
    catalog(event: CatalogProgress): string
    packageEvent(packageId: string, type: string): string
    packageBuild(packageId: string, state: PackageBuildState): string
    connection(state: "connecting" | "connected" | "reconnected" | "disconnected"): string
  }>
}
