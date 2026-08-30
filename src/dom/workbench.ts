/** Compiled six-region Storybook Workbench controller. */

import {
  CustomEvent,
  type Document,
  type HTMLDivElement,
  type HTMLInputElement,
  type HTMLElement,
  Node,
} from "@zavx0z/dom"
import {
  component,
  createRoot,
  keyedComponents,
  type ComponentRoot,
  type KeyedComponentsValue,
} from "@zavx0z/react"
import {
  isCompiledTemplate,
  type CompiledTemplate,
} from "@zavx0z/template/compiled"
import {
  normalizeStorybookDomNavigationItems,
  type StorybookDomNavigationItem,
} from "./navigation-tree.ts"
import {
  CustomWidgetSection,
  StandardWidgetSection,
  StorybookWorkbenchView,
} from "./workbench-view.tsx"

export type {
  StorybookDomNavigationGroup,
  StorybookDomNavigationItem,
} from "./navigation-tree.ts"

export const STORYBOOK_DOM_WORKBENCH_EVENTS = Object.freeze({
  navigate: "storybooknavigate",
  search: "storybooksearch",
  scenario: "storybookscenario",
  groupToggle: "storybookgrouptoggle",
} as const)

export const STORYBOOK_WORKBENCH_LAYOUT_PROTOCOL = "workbench-layout/1" as const
export const STORYBOOK_WORKBENCH_REGIONS = Object.freeze([
  "catalog",
  "secondary",
  "preview",
  "scenarios",
  "inspector",
  "status",
] as const)

export const STORYBOOK_DOM_STANDARD_WIDGET_REGISTRY = Object.freeze([
  Object.freeze({id: "props", kind: "props", label: "P", title: "Props"}),
  Object.freeze({id: "source", kind: "source", label: "S", title: "Source"}),
  Object.freeze({id: "events", kind: "events", label: "E", title: "Events"}),
  Object.freeze({id: "diagnostics", kind: "diagnostics", label: "!", title: "Diagnostics"}),
  Object.freeze({id: "dom", kind: "dom", label: "D", title: "DOM"}),
  Object.freeze({id: "layout", kind: "layout", label: "L", title: "Layout"}),
  Object.freeze({id: "display", kind: "display", label: "V", title: "Display"}),
  Object.freeze({id: "reference", kind: "reference", label: "R", title: "Reference"}),
] as const satisfies readonly StorybookDomInspectorWidgetRegistration[])

export type StorybookDomStandardWidgetKind =
  | "props"
  | "source"
  | "events"
  | "diagnostics"
  | "dom"
  | "layout"
  | "display"
  | "reference"

type StorybookDomInspectorStandardWidgetRegistration = Readonly<{
  id: string
  kind: StorybookDomStandardWidgetKind
  label: string
  title: string
}>

export type StorybookDomInspectorCustomWidgetRegistration = Readonly<{
  id: string
  kind: "custom"
  label: string
  title: string
  component: CompiledTemplate<Readonly<{value: unknown}>>
}>

export type StorybookDomInspectorWidgetRegistration =
  | StorybookDomInspectorStandardWidgetRegistration
  | StorybookDomInspectorCustomWidgetRegistration

export type StorybookDomInspectorSubject = Readonly<{
  packageId: string
  subjectId: string
  widgetIds: readonly string[]
}>

export type StorybookDomInspectorValues = Readonly<Record<string, unknown>>

export type StorybookDomScenarioItem = Readonly<{
  id: string
  label: string
  title?: string
  disabled?: boolean
}>

export type StorybookDomStatus = Readonly<{
  lead: string
  owner: string
  detail: string
}>

export type StorybookDomPresentationProjection = "display" | "hud" | "world"

export type StorybookDomPresentation = Readonly<{
  node: Node | null
  projection: StorybookDomPresentationProjection
}>

export type StorybookDomWorkbenchPresentationUpdate = Readonly<{
  label: string
  presentation: StorybookDomPresentation
  inspectorSubject: StorybookDomInspectorSubject | null
  inspectorValues: StorybookDomInspectorValues
}>

/** Every host-driven Workbench input has one exact typed address. */
export type StorybookDomWorkbenchAddressMap = Readonly<{
  title: string
  "catalog.label": string
  "catalog.search": string
  "catalog.items": readonly StorybookDomNavigationItem[]
  "catalog.active": string | null
  "secondary.label": string
  "secondary.items": readonly StorybookDomNavigationItem[]
  "secondary.active": string | null
  "preview.label": string
  presentation: StorybookDomPresentation
  "scenarios.label": string
  "scenarios.items": readonly StorybookDomScenarioItem[]
  "scenarios.active": string | null
  "inspector.registry": readonly StorybookDomInspectorWidgetRegistration[]
  "inspector.subject": StorybookDomInspectorSubject | null
  "inspector.values": StorybookDomInspectorValues
  status: StorybookDomStatus
}>

export type StorybookDomWorkbenchAddress = keyof StorybookDomWorkbenchAddressMap

export type StorybookDomWorkbenchController = Readonly<{
  read<Address extends StorybookDomWorkbenchAddress>(
    address: Address,
  ): StorybookDomWorkbenchAddressMap[Address]
  update<Address extends StorybookDomWorkbenchAddress>(
    address: Address,
    value: StorybookDomWorkbenchAddressMap[Address],
  ): void
  present(value: StorybookDomWorkbenchPresentationUpdate): void
  dispose(): void
}>

/** Stable semantic hosts created by one compiled ComponentRoot. */
export type StorybookDomWorkbenchElements = Readonly<{
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
  worldHost: HTMLElement
  scenarios: HTMLElement
  scenarioItems: HTMLDivElement
  inspectorHost: HTMLDivElement
  status: HTMLElement
}>

export type CreateStorybookDomWorkbenchOptions = Readonly<{
  document: Document
  parent?: Node
  initial?: Partial<StorybookDomWorkbenchAddressMap>
}>

export type StorybookDomWorkbench = Readonly<{
  document: Document
  element: HTMLDivElement
  elements: StorybookDomWorkbenchElements
  componentRoot: ComponentRoot
  controller: StorybookDomWorkbenchController
  update<Address extends StorybookDomWorkbenchAddress>(
    address: Address,
    value: StorybookDomWorkbenchAddressMap[Address],
  ): void
  present(value: StorybookDomWorkbenchPresentationUpdate): void
  dispose(): void
}>

export type StorybookDomWorkbenchViewState = {
  -readonly [Address in StorybookDomWorkbenchAddress]:
    StorybookDomWorkbenchAddressMap[Address]
}

type InspectorRetainedState = {
  selectedId: string
  query: string
  expanded: Map<string, boolean>
}

/**
 * Creates one compiled Workbench ComponentRoot in the supplied semantic
 * Document. Preview projection changes reparent the exact external Node between
 * fixed same-Document display/HUD/world hosts without remounting it.
 */
export function createStorybookDomWorkbench(
  options: CreateStorybookDomWorkbenchOptions,
): StorybookDomWorkbench {
  const {document} = options
  const parent = options.parent
  if (parent !== undefined) assertNodeInDocument(parent, document, "Workbench parent")
  let disposed = false
  let state = initialState(options.initial)
  const inspectorStateBySubject = new Map<string, InspectorRetainedState>()
  const staging = document.createDocumentFragment()
  const componentRoot = createRoot(staging, {identifierPrefix: "storybook-workbench"})
  let rerender = (): void => {}

  const onCatalogNavigate = (item: StorybookDomNavigationItem, source: HTMLElement): void => {
    update("catalog.active", item.id)
    source.dispatchEvent(new CustomEvent(STORYBOOK_DOM_WORKBENCH_EVENTS.navigate, {
      bubbles: true,
      detail: Object.freeze({kind: "catalog", id: item.id, route: item.route}),
    }))
  }
  const onCatalogSearch = (value: string, source: HTMLElement): void => {
    update("catalog.search", value)
    source.dispatchEvent(new CustomEvent(STORYBOOK_DOM_WORKBENCH_EVENTS.search, {
      bubbles: true,
      detail: Object.freeze({value}),
    }))
  }
  const onGroupToggle = (
    group: Readonly<{id: string; label: string}>,
    collapsed: boolean,
    source: HTMLElement,
  ): void => {
    source.dispatchEvent(new CustomEvent(STORYBOOK_DOM_WORKBENCH_EVENTS.groupToggle, {
      bubbles: true,
      detail: Object.freeze({kind: "catalog", id: group.id, collapsed}),
    }))
  }
  const onSecondaryNavigate = (item: StorybookDomNavigationItem, source: HTMLElement): void => {
    update("secondary.active", item.id)
    source.dispatchEvent(new CustomEvent(STORYBOOK_DOM_WORKBENCH_EVENTS.navigate, {
      bubbles: true,
      detail: Object.freeze({kind: "secondary", id: item.id, route: item.route}),
    }))
  }
  const onScenario = (item: StorybookDomScenarioItem, source: HTMLElement): void => {
    update("scenarios.active", item.id)
    source.dispatchEvent(new CustomEvent(STORYBOOK_DOM_WORKBENCH_EVENTS.scenario, {
      bubbles: true,
      detail: Object.freeze({id: item.id}),
    }))
  }
  const onInspectorCategoryChange = (id: string): void => {
    const retained = retainedInspectorState(state, inspectorStateBySubject)
    if (retained === null || !activeInspectorWidgets(state).some(widget => widget.id === id)) return
    retained.selectedId = id
    rerender()
  }
  const onInspectorQueryChange = (query: string): void => {
    const retained = retainedInspectorState(state, inspectorStateBySubject)
    if (retained === null) return
    retained.query = query
    rerender()
  }
  const onInspectorToggle = (id: string, expanded: boolean): void => {
    const retained = retainedInspectorState(state, inspectorStateBySubject)
    if (retained === null || !activeInspectorWidgets(state).some(widget => widget.id === id)) return
    retained.expanded.set(id, expanded)
    rerender()
  }

  const renderState = (candidate: StorybookDomWorkbenchViewState): void => {
    const inspector = inspectorProjection(
      candidate,
      inspectorStateBySubject,
      onInspectorToggle,
    )
    componentRoot.render(StorybookWorkbenchView as any, {
      document,
      state: candidate,
      inspectorSelectedId: inspector.selectedId,
      inspectorQuery: inspector.query,
      onCatalogNavigate,
      onCatalogSearch,
      onGroupToggle,
      onSecondaryNavigate,
      onScenario,
      onInspectorCategoryChange,
      onInspectorQueryChange,
      children: inspector.sections,
    })
  }
  rerender = () => renderState(state)
  rerender()
  const element = exactElement(staging, "[data-storybook-workbench]", "Workbench root") as HTMLDivElement
  const elements = readElements(element)
  parent?.appendChild(element)
  componentRoot.flush()
  syncPresentation(null, state.presentation, elements, document)

  const read = <Address extends StorybookDomWorkbenchAddress>(
    address: Address,
  ): StorybookDomWorkbenchAddressMap[Address] => {
    assertActive(disposed)
    return state[address as keyof StorybookDomWorkbenchViewState] as StorybookDomWorkbenchAddressMap[Address]
  }

  const update = <Address extends StorybookDomWorkbenchAddress>(
    address: Address,
    value: StorybookDomWorkbenchAddressMap[Address],
  ): void => {
    assertActive(disposed)
    const previousPresentation = state.presentation
    const next = updatedState(state, address, value, document)
    renderState(next)
    state = next
    syncPresentation(previousPresentation, next.presentation, elements, document)
  }

  const present = (value: StorybookDomWorkbenchPresentationUpdate): void => {
    assertActive(disposed)
    const presentation = presentationValue(value?.presentation)
    if (presentation.node !== null) assertNodeInDocument(presentation.node, document, "Presentation node")
    const subject = inspectorSubject(value?.inspectorSubject, state["inspector.registry"])
    const values = inspectorValues(value?.inspectorValues)
    const next: StorybookDomWorkbenchViewState = {
      ...state,
      "preview.label": requiredText("Preview label", value?.label),
      presentation,
      "inspector.subject": subject,
      "inspector.values": values,
    }
    const previousPresentation = state.presentation
    renderState(next)
    state = next
    syncPresentation(previousPresentation, presentation, elements, document)
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const node = state.presentation.node
    if (node !== null && node.parentNode !== null) node.parentNode.removeChild(node)
    componentRoot.unmount()
    if (element.parentNode !== null) element.parentNode.removeChild(element)
  }

  const controller: StorybookDomWorkbenchController = Object.freeze({read, update, present, dispose})
  return Object.freeze({
    document,
    element,
    elements,
    componentRoot,
    controller,
    update,
    present,
    dispose,
  })
}

function inspectorProjection(
  state: StorybookDomWorkbenchViewState,
  retainedBySubject: Map<string, InspectorRetainedState>,
  onToggle: (id: string, expanded: boolean) => void,
): Readonly<{
  selectedId: string
  query: string
  sections: KeyedComponentsValue
}> {
  const widgets = activeInspectorWidgets(state)
  const retained = retainedInspectorState(state, retainedBySubject)
  const selectedId = retained?.selectedId ?? ""
  const query = retained?.query ?? ""
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU")
  const sections = widgets.map(widget => {
    const hidden = widget.id !== selectedId || normalizedQuery.length > 0 &&
      !`${widget.id} ${widget.title}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery)
    const sectionProps = {
      widget,
      value: state["inspector.values"][widget.id],
      expanded: retained?.expanded.get(widget.id) ?? true,
      hidden,
      onToggle,
    }
    if (widget.kind !== "custom") {
      return component(
        StandardWidgetSection as unknown as CompiledTemplate<typeof sectionProps>,
        sectionProps,
        widget.id,
      )
    }
    const child = component(widget.component, Object.freeze({
      value: state["inspector.values"][widget.id],
    }), `${widget.id}:value`)
    return component(
      CustomWidgetSection as unknown as CompiledTemplate<typeof sectionProps & Readonly<{children: typeof child}>>,
      {...sectionProps, children: child},
      widget.id,
    )
  })
  return Object.freeze({selectedId, query, sections: keyedComponents(sections)})
}

function activeInspectorWidgets(
  state: StorybookDomWorkbenchViewState,
): readonly StorybookDomInspectorWidgetRegistration[] {
  const subject = state["inspector.subject"]
  if (subject === null) return Object.freeze([])
  return Object.freeze(subject.widgetIds.map(id =>
    state["inspector.registry"].find(widget => widget.id === id)!))
}

function retainedInspectorState(
  state: StorybookDomWorkbenchViewState,
  retainedBySubject: Map<string, InspectorRetainedState>,
): InspectorRetainedState | null {
  const subject = state["inspector.subject"]
  if (subject === null) return null
  const widgets = activeInspectorWidgets(state)
  const key = `${subject.packageId}\0${subject.subjectId}`
  let retained = retainedBySubject.get(key)
  if (retained === undefined) {
    retained = {selectedId: widgets[0]?.id ?? "", query: "", expanded: new Map()}
    retainedBySubject.set(key, retained)
  } else if (!widgets.some(widget => widget.id === retained!.selectedId)) {
    retained.selectedId = widgets[0]?.id ?? ""
  }
  return retained
}

function initialState(
  initial: Partial<StorybookDomWorkbenchAddressMap> | undefined,
): StorybookDomWorkbenchViewState {
  const registry = widgetRegistry(initial?.["inspector.registry"] ?? STORYBOOK_DOM_STANDARD_WIDGET_REGISTRY)
  const presentation = presentationValue(initial?.presentation ?? Object.freeze({
    node: null,
    projection: "display",
  }))
  const state: StorybookDomWorkbenchViewState = {
    title: requiredText("Workbench title", initial?.title ?? "Storybook"),
    "catalog.label": requiredText("Catalog label", initial?.["catalog.label"] ?? "Каталог"),
    "catalog.search": stringValue("Catalog search", initial?.["catalog.search"] ?? ""),
    "catalog.items": navigationItems("Catalog", initial?.["catalog.items"] ?? Object.freeze([])),
    "catalog.active": null,
    "secondary.label": requiredText("Secondary navigation label", initial?.["secondary.label"] ?? "Разделы"),
    "secondary.items": navigationItems("Secondary navigation", initial?.["secondary.items"] ?? Object.freeze([])),
    "secondary.active": null,
    "preview.label": requiredText("Preview label", initial?.["preview.label"] ?? "Предпросмотр"),
    presentation,
    "scenarios.label": requiredText("Scenario label", initial?.["scenarios.label"] ?? "Сценарии"),
    "scenarios.items": scenarioItemsValue(initial?.["scenarios.items"] ?? Object.freeze([])),
    "scenarios.active": null,
    "inspector.registry": registry,
    "inspector.subject": inspectorSubject(initial?.["inspector.subject"] ?? null, registry),
    "inspector.values": inspectorValues(initial?.["inspector.values"] ?? Object.freeze({})),
    status: statusValue(initial?.status ?? {lead: "Создано для ", owner: "MetaFor", detail: " · Storybook"}),
  }
  state["catalog.active"] = selectedId(
    "Catalog",
    initial?.["catalog.active"] ?? null,
    state["catalog.items"],
  )
  state["secondary.active"] = selectedId(
    "Secondary navigation",
    initial?.["secondary.active"] ?? null,
    state["secondary.items"],
  )
  state["scenarios.active"] = selectedId(
    "Scenario",
    initial?.["scenarios.active"] ?? null,
    state["scenarios.items"],
  )
  return state
}

function updatedState<Address extends StorybookDomWorkbenchAddress>(
  current: StorybookDomWorkbenchViewState,
  address: Address,
  value: StorybookDomWorkbenchAddressMap[Address],
  document: Document,
): StorybookDomWorkbenchViewState {
  const next = {...current}
  switch (address) {
    case "title":
      next.title = requiredText("Workbench title", value)
      break
    case "catalog.label":
      next["catalog.label"] = requiredText("Catalog label", value)
      break
    case "catalog.search":
      next["catalog.search"] = stringValue("Catalog search", value)
      break
    case "catalog.items":
      next["catalog.items"] = navigationItems("Catalog", value)
      if (next["catalog.active"] !== null && !next["catalog.items"].some(item =>
        item.id === next["catalog.active"])) next["catalog.active"] = null
      break
    case "catalog.active":
      next["catalog.active"] = selectedId("Catalog", value, next["catalog.items"])
      break
    case "secondary.label":
      next["secondary.label"] = requiredText("Secondary navigation label", value)
      break
    case "secondary.items":
      next["secondary.items"] = navigationItems("Secondary navigation", value)
      if (next["secondary.active"] !== null && !next["secondary.items"].some(item =>
        item.id === next["secondary.active"])) next["secondary.active"] = null
      break
    case "secondary.active":
      next["secondary.active"] = selectedId("Secondary navigation", value, next["secondary.items"])
      break
    case "preview.label":
      next["preview.label"] = requiredText("Preview label", value)
      break
    case "presentation": {
      const presentation = presentationValue(value)
      if (presentation.node !== null) assertNodeInDocument(presentation.node, document, "Presentation node")
      next.presentation = presentation
      break
    }
    case "scenarios.label":
      next["scenarios.label"] = requiredText("Scenario label", value)
      break
    case "scenarios.items":
      next["scenarios.items"] = scenarioItemsValue(value)
      if (next["scenarios.active"] !== null && !next["scenarios.items"].some(item =>
        item.id === next["scenarios.active"])) next["scenarios.active"] = null
      break
    case "scenarios.active":
      next["scenarios.active"] = selectedId("Scenario", value, next["scenarios.items"])
      break
    case "inspector.registry":
      next["inspector.registry"] = widgetRegistry(value)
      next["inspector.subject"] = inspectorSubject(next["inspector.subject"], next["inspector.registry"])
      break
    case "inspector.subject":
      next["inspector.subject"] = inspectorSubject(value, next["inspector.registry"])
      break
    case "inspector.values":
      next["inspector.values"] = inspectorValues(value)
      break
    case "status":
      next.status = statusValue(value)
      break
  }
  return next
}

function syncPresentation(
  previous: StorybookDomPresentation | null,
  next: StorybookDomPresentation,
  elements: StorybookDomWorkbenchElements,
  document: Document,
): void {
  if (next.node !== null) assertNodeInDocument(next.node, document, "Presentation node")
  const previousNode = previous?.node ?? null
  if (previousNode !== null && previousNode !== next.node && previousNode.parentNode !== null) {
    previousNode.parentNode.removeChild(previousNode)
  }
  if (next.node === null) return
  const host = next.projection === "display"
    ? elements.displayHost
    : next.projection === "hud"
      ? elements.hudHost
      : elements.worldHost
  if (next.node.parentNode !== host) host.appendChild(next.node)
}

function readElements(root: HTMLDivElement): StorybookDomWorkbenchElements {
  return Object.freeze({
    root,
    body: exactElement(root, '[data-storybook-workbench-part="body"]', "Workbench body") as HTMLDivElement,
    catalog: exactElement(root, '[data-storybook-region="catalog"]', "Catalog region"),
    catalogSearch: exactElement(root, '[data-storybook-part="catalog-search"] input', "Catalog search") as HTMLInputElement,
    catalogItems: exactElement(root, '[data-storybook-tree="catalog"]', "Catalog items") as HTMLDivElement,
    secondary: exactElement(root, '[data-storybook-region="secondary"]', "Secondary region"),
    secondaryItems: exactElement(root, '[data-storybook-part="secondary-items"]', "Secondary items") as HTMLDivElement,
    preview: exactElement(root, '[data-storybook-region="preview"]', "Preview region"),
    previewHost: exactElement(root, '[data-storybook-part="preview-host"]', "Preview host"),
    displayHost: exactElement(root, '[data-storybook-projection="display"]', "Display projection host"),
    hudHost: exactElement(root, '[data-storybook-projection="hud"]', "HUD projection host"),
    worldHost: exactElement(root, '[data-storybook-projection="world"]', "World projection host"),
    scenarios: exactElement(root, '[data-storybook-region="scenarios"]', "Scenarios region"),
    scenarioItems: exactElement(root, '[data-storybook-part="scenario-items"]', "Scenario items") as HTMLDivElement,
    inspectorHost: exactElement(root, '[data-storybook-region="inspector"]', "Inspector region") as HTMLDivElement,
    status: exactElement(root, '[data-storybook-region="status"]', "Status region"),
  })
}

function exactElement(root: Node, selector: string, label: string): HTMLElement {
  if (!("querySelectorAll" in root)) throw new TypeError(`${label} root cannot be queried`)
  const matches = [...(root as Node & {querySelectorAll(selector: string): readonly HTMLElement[]}).querySelectorAll(selector)]
  if (matches.length !== 1) throw new Error(`${label} must have one exact element, received ${matches.length}`)
  return matches[0]!
}

function navigationItems(label: string, value: unknown): readonly StorybookDomNavigationItem[] {
  return normalizeStorybookDomNavigationItems(label, value)
}

function scenarioItemsValue(value: unknown): readonly StorybookDomScenarioItem[] {
  if (!Array.isArray(value)) throw new TypeError("Scenario items must be an array")
  const ids = new Set<string>()
  return Object.freeze(value.map((candidate, index) => {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`Scenario item ${index} must be an object`)
    }
    const item = candidate as StorybookDomScenarioItem
    const id = requiredText("Scenario item id", item.id)
    if (ids.has(id)) throw new Error(`Duplicate scenario item id: ${id}`)
    ids.add(id)
    return Object.freeze({
      id,
      label: requiredText("Scenario item label", item.label),
      ...(item.title === undefined ? {} : {title: stringValue("Scenario item title", item.title)}),
      ...(item.disabled === undefined ? {} : {disabled: Boolean(item.disabled)}),
    })
  }))
}

function widgetRegistry(value: unknown): readonly StorybookDomInspectorWidgetRegistration[] {
  if (!Array.isArray(value)) throw new TypeError("Inspector widget registry must be an array")
  const ids = new Set<string>()
  const result = value.map((candidate, index) => {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`Inspector widget ${index} must be an object`)
    }
    const widget = candidate as StorybookDomInspectorWidgetRegistration
    const id = requiredText(`Inspector widget ${index} id`, widget.id)
    if (ids.has(id)) throw new Error(`Duplicate Inspector widget id: ${id}`)
    ids.add(id)
    if (!["props", "source", "events", "diagnostics", "dom", "layout", "display", "reference", "custom"]
      .includes(widget.kind)) throw new Error(`Unknown Inspector widget kind: ${String(widget.kind)}`)
    if (widget.kind !== "custom" && widget.kind !== id) {
      throw new Error(`Standard Inspector widget id must equal its kind: ${id}`)
    }
    const label = requiredText(`Inspector widget ${index} label`, widget.label)
    const title = requiredText(`Inspector widget ${index} title`, widget.title)
    if (widget.kind !== "custom") return Object.freeze({id, kind: widget.kind, label, title})
    if (!isCompiledTemplate(widget.component)) {
      throw new TypeError(`Custom Inspector widget component must be a governed compiled template: ${id}`)
    }
    return Object.freeze({id, kind: "custom" as const, label, title, component: widget.component})
  })
  const standard = STORYBOOK_DOM_STANDARD_WIDGET_REGISTRY.map(({id}) => id)
  const presentStandard = result.filter(({kind}) => kind !== "custom").map(({id}) => id)
  if (presentStandard.length !== standard.length ||
    presentStandard.some((id, index) => id !== standard[index])) {
    throw new Error("Standard Inspector widget registry order is fixed")
  }
  return Object.freeze(result)
}

function inspectorSubject(
  value: unknown,
  registry: readonly StorybookDomInspectorWidgetRegistration[],
): StorybookDomInspectorSubject | null {
  if (value === null) return null
  if (value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Inspector subject must be an object or null")
  }
  const subject = value as StorybookDomInspectorSubject
  if (!Array.isArray(subject.widgetIds)) throw new TypeError("Inspector subject widgetIds must be an array")
  const available = new Set(registry.map(({id}) => id))
  const seen = new Set<string>()
  const widgetIds = subject.widgetIds.map((candidate, index) => {
    const id = requiredText(`Inspector subject widget ${index}`, candidate)
    if (!available.has(id)) throw new Error(`Inspector subject references unknown widget: ${id}`)
    if (seen.has(id)) throw new Error(`Inspector subject repeats widget: ${id}`)
    seen.add(id)
    return id
  })
  return Object.freeze({
    packageId: requiredText("Inspector subject packageId", subject.packageId),
    subjectId: requiredText("Inspector subject subjectId", subject.subjectId),
    widgetIds: Object.freeze(widgetIds),
  })
}

function inspectorValues(value: unknown): StorybookDomInspectorValues {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Inspector values must be an object")
  }
  return Object.freeze({...value as Record<string, unknown>})
}

function presentationValue(value: unknown): StorybookDomPresentation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Workbench presentation must be an object")
  }
  const candidate = value as StorybookDomPresentation
  if (candidate.projection !== "display" && candidate.projection !== "hud" && candidate.projection !== "world") {
    throw new Error(`Unknown Workbench presentation projection: ${String(candidate.projection)}`)
  }
  if (candidate.node !== null && !(candidate.node instanceof Node)) {
    throw new TypeError("Workbench presentation node must be a Node from @zavx0z/dom")
  }
  return Object.freeze({node: candidate.node, projection: candidate.projection})
}

function selectedId(
  label: string,
  value: unknown,
  items: readonly Readonly<{id: string}>[],
): string | null {
  if (value === null) return null
  const id = requiredText(`${label} active id`, value)
  if (!items.some(item => item.id === id)) throw new Error(`Unknown ${label.toLowerCase()} item id: ${id}`)
  return id
}

function statusValue(value: unknown): StorybookDomStatus {
  if (value === null || typeof value !== "object") throw new TypeError("Status must be an object")
  const status = value as StorybookDomStatus
  return Object.freeze({
    lead: stringValue("Status lead", status.lead),
    owner: requiredText("Status owner", status.owner),
    detail: stringValue("Status detail", status.detail),
  })
}

function requiredText(label: string, value: unknown): string {
  const text = stringValue(label, value)
  if (text.trim().length === 0) throw new Error(`${label} must not be empty`)
  return text
}

function stringValue(label: string, value: unknown): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`)
  return value
}

function assertNodeInDocument(node: Node, document: Document, label: string): void {
  if (!(node instanceof Node)) throw new TypeError(`${label} must be a Node from @zavx0z/dom`)
  if (node !== document && node.ownerDocument !== document) throw new Error(`${label} belongs to another Document`)
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("DOM Workbench is disposed")
}
