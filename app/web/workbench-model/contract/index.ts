import type {Document, HTMLDivElement, Node} from "@zavx0z/dom"
import type {WorkbenchViewProps} from "./view"
import type {
  Workbench, WorkbenchProjectionHosts, WorkbenchAddressMap, WorkbenchUserState,
  NavigationExpansion,
} from "./workbench"

/** Состояние Workbench и управление существующим semantic Document. */
export declare namespace WebWorkbenchModel {
  /** Создание общей модели без отдельного Browser Root или component mount. */
  export type Input = Readonly<{
    userState?: WorkbenchUserState | undefined
    document: Document | globalThis.Document
    parent?: Node
    projectionHosts?: WorkbenchProjectionHosts
    initial?: Partial<WorkbenchAddressMap>
    navigationExpansion?: NavigationExpansion | undefined
  }>

  export type Output = Readonly<{
    getSnapshot(): WorkbenchViewProps
    subscribe(listener: () => void): () => boolean
    bind(target: HTMLDivElement, hosts?: WorkbenchProjectionHosts): Workbench
    dispose(): void
  }>
}
