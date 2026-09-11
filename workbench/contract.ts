import type {
  Document,
  HTMLDivElement,
  HTMLInputElement,
  HTMLElement,
  Node,
} from "@zavx0z/dom"
import type {ComponentRoot} from "@zavx0z/component"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {
  WorkbenchNavigationGroup,
  WorkbenchNavigationItem,
} from "./navigation/model.ts"

export const WORKBENCH_EVENTS = Object.freeze({
  navigate: "storybooknavigate",
  search: "storybooksearch",
  tab: "storybooktab",
  inspector: "storybookinspector",
  groupToggle: "storybookgrouptoggle",
  catalogAction: "storybookcatalogaction",
} as const)

export const WORKBENCH_LAYOUT_PROTOCOL = "workbench-layout/2" as const

export const WORKBENCH_REGIONS = Object.freeze([
  "catalog",
  "secondary",
  "tabs",
  "preview",
  "inspector",
  "status",
] as const)

export type WorkbenchStandardWidgetKind =
  | "props"
  | "source"
  | "events"
  | "diagnostics"
  | "dom"
  | "layout"
  | "display"
  | "reference"

export type WorkbenchInspectorStandardWidgetRegistration = Readonly<{
  id: string
  kind: WorkbenchStandardWidgetKind
  label: string
  title: string
  iconSrc?: string
}>

export type WorkbenchInspectorCustomWidgetRegistration = Readonly<{
  id: string
  kind: "custom"
  label: string
  title: string
  iconSrc?: string
  /** false оставляет собственную шапку widget без дополнительной сворачиваемой панели. */
  wrapInPanel?: boolean
  component: CompiledTemplate<WorkbenchInspectorCustomWidgetProps>
}>

/**
Свойства встроенного в Inspector custom widget.

`expandedKeys` принадлежат рабочему пространству Inspector, а не временно
смонтированному DOM widget. Поэтому раскрытие вложенной структуры переживает
переход на другую вкладку и возврат к тому же workspace.

@property value - Значение, связанное с registration текущей секции.

@property expandedKeys - Retained раскрытые строки вложенной структуры widget.

@property onExpandedChange - Записывает следующий набор раскрытых строк workspace.
*/
export type WorkbenchInspectorCustomWidgetProps = Readonly<{
  value: unknown
  expandedKeys: readonly string[]
  onExpandedChange(keys: readonly string[]): void
}>

export type WorkbenchInspectorWidgetRegistration =
  | WorkbenchInspectorStandardWidgetRegistration
  | WorkbenchInspectorCustomWidgetRegistration

/**
Контекст Inspector, принадлежащий одному presentation workspace.

@property packageId - Exact package identity, изолирующая состояние разных пакетов.

@property subjectId - Domain identity предмета, показываемая вместе с workspace.

@property [workspaceId] - Stable route-specific key для независимого retained state вкладки.

@property widgetIds - Упорядоченные registrations, доступные в этом workspace.
*/
export type WorkbenchInspectorSubject = Readonly<{
  packageId: string
  subjectId: string
  workspaceId?: string
  widgetIds: readonly string[]
}>

export type WorkbenchInspectorValues = Readonly<Record<string, unknown>>

export type WorkbenchBreadcrumb = Readonly<{
  id: string
  label: string
  iconSrc?: string
  route: string
  urlPath?: string
  title?: string
  disabled?: boolean
}>

/** Адресуемая вкладка панели; маршрут передаётся хосту вместе с выбором. */
export type WorkbenchTabItem = Readonly<{
  id: string
  label: string
  route: string
  title?: string
  disabled?: boolean
}>

export type WorkbenchStatus = Readonly<{
  lead: string
  owner: string
  detail: string
  breadcrumbs?: readonly WorkbenchBreadcrumb[]
}>

export type WorkbenchPresentationProjection = "display" | "hud" | "space"

export type WorkbenchPresentation = Readonly<{
  node: Node | null
  projection: WorkbenchPresentationProjection
}>

export type WorkbenchPresentationUpdate = Readonly<{
  label: string
  presentation: WorkbenchPresentation
  inspectorSubject: WorkbenchInspectorSubject | null
  inspectorValues: WorkbenchInspectorValues
}>

export type WorkbenchProjectionHosts = Readonly<{
  display?: Node
  space?: Node
}>

export type WorkbenchCatalogManagement = Readonly<{
  pending: boolean
  error: string
  removableIds: readonly string[]
}>

export type WorkbenchCatalogAction = Readonly<{
  action: "attach" | "detach"
  value?: string
}>

/** Every host-driven Workbench input has one exact typed address. */
export type WorkbenchAddressMap = Readonly<{
  title: string
  "catalog.management": WorkbenchCatalogManagement | null
  "catalog.label": string
  "catalog.search": string
  "catalog.items": readonly WorkbenchNavigationItem[]
  "catalog.active": string | null
  "secondary.label": string
  "secondary.items": readonly WorkbenchNavigationItem[]
  "secondary.active": string | null
  "preview.label": string
  presentation: WorkbenchPresentation
  "tabs.label": string
  "tabs.items": readonly WorkbenchTabItem[]
  "tabs.active": string | null
  "inspector.registry": readonly WorkbenchInspectorWidgetRegistration[]
  "inspector.subject": WorkbenchInspectorSubject | null
  "inspector.values": WorkbenchInspectorValues
  status: WorkbenchStatus
}>

export type WorkbenchAddress = keyof WorkbenchAddressMap

export type WorkbenchController = Readonly<{
  read<Address extends WorkbenchAddress>(address: Address): WorkbenchAddressMap[Address]
  update<Address extends WorkbenchAddress>(
    address: Address,
    value: WorkbenchAddressMap[Address],
  ): void
  present(value: WorkbenchPresentationUpdate): void
  selectedInspector(): string | null
  selectInspector(id: string | null): void
  dispose(): void
}>

/** Stable semantic hosts created by one compiled ComponentRoot. */
export type WorkbenchElements = Readonly<{
  root: HTMLDivElement
  body: HTMLDivElement
  catalog: HTMLElement
  catalogSearch: HTMLInputElement
  catalogItems: HTMLDivElement
  secondary: HTMLElement
  secondaryItems: HTMLDivElement
  preview: HTMLElement
  previewHost: HTMLElement
  displayHost: HTMLElement
  hudHost: HTMLElement
  spaceHost: HTMLElement
  tabs: HTMLElement
  tabItems: HTMLDivElement
  inspectorHost: HTMLDivElement
  status: HTMLElement
}>

export type CreateWorkbenchOptions = Readonly<{
  document: Document
  parent?: Node
  projectionHosts?: WorkbenchProjectionHosts
  initial?: Partial<WorkbenchAddressMap>
}>

export type Workbench = Readonly<{
  document: Document
  element: HTMLDivElement
  elements: WorkbenchElements
  controller: WorkbenchController
  update<Address extends WorkbenchAddress>(
    address: Address,
    value: WorkbenchAddressMap[Address],
  ): void
  present(value: WorkbenchPresentationUpdate): void
  selectedInspector(): string | null
  selectInspector(id: string | null): void
  dispose(): void
}>

export type WorkbenchViewState = {
  -readonly [Address in WorkbenchAddress]: WorkbenchAddressMap[Address]
}

export type {
  WorkbenchNavigationGroup,
  WorkbenchNavigationItem,
} from "./navigation/model.ts"
