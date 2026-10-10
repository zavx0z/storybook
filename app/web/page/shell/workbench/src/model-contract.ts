import type {Document, HTMLDivElement, Node} from "@zavx0z/immersive"
import type {WorkbenchViewProps} from "../contract/view"
import type {
  Workbench, WorkbenchAddressMap, WorkbenchUserState,
  NavigationExpansion,
} from "../contract/workbench"

/** Узлы проекций, переданные частной модели уже созданного Document. */
export type WorkbenchProjectionHosts = Readonly<{
  display?: Node
  hud?: Node
  space?: Node
}>

/** Состояние Workbench и управление существующим semantic Document. */
export declare namespace WorkbenchModel {
  /** Создание общей модели без отдельного Browser Root или component mount. */
  export type Input = Readonly<{
    userState?: WorkbenchUserState | undefined
    document: Document | globalThis.Document
    parent?: Node
    projectionHosts?: WorkbenchProjectionHosts
    initial?: Partial<WorkbenchAddressMap> | undefined
    navigationExpansion?: NavigationExpansion | undefined
  }>

  export type Output = Readonly<{
    getSnapshot(): WorkbenchViewProps
    subscribe(listener: () => void): () => boolean
    bind(target: HTMLDivElement, hosts?: WorkbenchProjectionHosts): Workbench
    dispose(): void
  }>
}
