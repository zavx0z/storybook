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
  scenario: "storybookscenario",
  groupToggle: "storybookgrouptoggle",
} as const)

export const WORKBENCH_LAYOUT_PROTOCOL = "workbench-layout/2" as const

export const WORKBENCH_REGIONS = Object.freeze([
  "catalog",
  "secondary",
  "scenarios",
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
  component: CompiledTemplate<Readonly<{value: unknown}>>
}>

export type WorkbenchInspectorWidgetRegistration =
  | WorkbenchInspectorStandardWidgetRegistration
  | WorkbenchInspectorCustomWidgetRegistration

export type WorkbenchInspectorSubject = Readonly<{
  packageId: string
  subjectId: string
  widgetIds: readonly string[]
}>

export type WorkbenchInspectorValues = Readonly<Record<string, unknown>>

export type WorkbenchScenarioItem = Readonly<{
  id: string
  label: string
  title?: string
  disabled?: boolean
}>

export type WorkbenchStatus = Readonly<{
  lead: string
  owner: string
  detail: string
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

/** Every host-driven Workbench input has one exact typed address. */
export type WorkbenchAddressMap = Readonly<{
  title: string
  "catalog.label": string
  "catalog.search": string
  "catalog.items": readonly WorkbenchNavigationItem[]
  "catalog.active": string | null
  "secondary.label": string
  "secondary.items": readonly WorkbenchNavigationItem[]
  "secondary.active": string | null
  "preview.label": string
  presentation: WorkbenchPresentation
  "scenarios.label": string
  "scenarios.items": readonly WorkbenchScenarioItem[]
  "scenarios.active": string | null
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
  scenarios: HTMLElement
  scenarioItems: HTMLDivElement
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
  componentRoot: ComponentRoot
  controller: WorkbenchController
  update<Address extends WorkbenchAddress>(
    address: Address,
    value: WorkbenchAddressMap[Address],
  ): void
  present(value: WorkbenchPresentationUpdate): void
  dispose(): void
}>

export type WorkbenchViewState = {
  -readonly [Address in WorkbenchAddress]: WorkbenchAddressMap[Address]
}

export type {
  WorkbenchNavigationGroup,
  WorkbenchNavigationItem,
} from "./navigation/model.ts"
