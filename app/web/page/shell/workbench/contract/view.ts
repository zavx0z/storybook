import type {Document as SemanticDocument} from "@immersive/dom"
import type {JSX} from "@immersive-jsx-compiler/session"
import type {
  WorkbenchNavigationGroup, WorkbenchCatalogAction, WorkbenchNavigationItem,
  WorkbenchBreadcrumb, WorkbenchTabItem, WorkbenchViewState, NavigationExpansion,
} from "./workbench"

export type WorkbenchViewProps = Readonly<{
  mcpOpen?: boolean | undefined
  onMcpOpenChange?: ((open: boolean) => void) | undefined
  document: SemanticDocument
  onElement?: ((node: HTMLDivElement | null) => void) | undefined
  state: WorkbenchViewState
  navigationExpansion?: NavigationExpansion | undefined
  inspectorSelectedId: string
  inspectorQuery: string
  onCatalogAction(action: WorkbenchCatalogAction, source: HTMLElement): void
  onCatalogNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
  onCatalogSearch(value: string, source: HTMLElement): void
  onGroupToggle(group: WorkbenchNavigationGroup, collapsed: boolean, source: HTMLElement): void
  onTab(item: WorkbenchTabItem, source: HTMLElement): void
  onInspectorCategoryChange(id: string): void
  onInspectorQueryChange(query: string): void
  onStatusNavigate(item: WorkbenchBreadcrumb, source: HTMLElement): void
  children: readonly JSX.Element[]
}>
