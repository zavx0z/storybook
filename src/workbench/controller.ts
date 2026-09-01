/** One compiled six-region Storybook Workbench controller. */

import {
  CustomEvent,
  type HTMLDivElement,
  type HTMLElement,
} from "@zavx0z/dom"
import {createRoot} from "@zavx0z/react"
import type {
  CreateWorkbenchOptions,
  Workbench,
  WorkbenchAddress,
  WorkbenchAddressMap,
  WorkbenchController,
  WorkbenchNavigationGroup,
  WorkbenchNavigationItem,
  WorkbenchPresentationUpdate,
  WorkbenchScenarioItem,
  WorkbenchViewState,
} from "./contract.ts"
import {
  WORKBENCH_EVENTS,
} from "./contract.ts"
import {
  exactWorkbenchElement,
  readWorkbenchElements,
} from "./elements.ts"
import {
  projectWorkbenchInspector,
  retainedWorkbenchInspectorState,
  type WorkbenchInspectorRetainedState,
} from "./inspector/projection.ts"
import {activeWorkbenchInspectorWidgets} from "./inspector/registry.ts"
import {
  validateWorkbenchInspectorSubject,
  validateWorkbenchInspectorValues,
} from "./inspector/registry.ts"
import {
  assertNodeInDocument,
  syncWorkbenchPresentation,
  validateWorkbenchPresentation,
} from "./presentation.ts"
import {
  createInitialWorkbenchState,
  updateWorkbenchState,
} from "./state.ts"
import {requiredText} from "./validation.ts"
import {WorkbenchView} from "./view.tsx"

/**
 * Creates one compiled Workbench ComponentRoot in the supplied semantic
 * Document. Projection changes reparent the exact external Node between fixed
 * same-Document display/HUD/world hosts without remounting it.
 */
export function createWorkbench(options: CreateWorkbenchOptions): Workbench {
  const {document} = options
  const parent = options.parent
  if (parent !== undefined) assertNodeInDocument(parent, document, "Workbench parent")
  let disposed = false
  let state = createInitialWorkbenchState(options.initial, document)
  const inspectorStateBySubject = new Map<string, WorkbenchInspectorRetainedState>()
  const staging = document.createDocumentFragment()
  const componentRoot = createRoot(staging, {identifierPrefix: "storybook-workbench"})
  let rerender = (): void => {}

  const onCatalogNavigate = (item: WorkbenchNavigationItem, source: HTMLElement): void => {
    update("catalog.active", item.id)
    source.dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.navigate, {
      bubbles: true,
      detail: Object.freeze({kind: "catalog", id: item.id, route: item.route}),
    }))
  }
  const onCatalogSearch = (value: string, source: HTMLElement): void => {
    update("catalog.search", value)
    source.dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.search, {
      bubbles: true,
      detail: Object.freeze({value}),
    }))
  }
  const onGroupToggle = (
    group: WorkbenchNavigationGroup,
    collapsed: boolean,
    source: HTMLElement,
  ): void => {
    source.dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.groupToggle, {
      bubbles: true,
      detail: Object.freeze({kind: "catalog", id: group.id, collapsed}),
    }))
  }
  const onSecondaryNavigate = (item: WorkbenchNavigationItem, source: HTMLElement): void => {
    update("secondary.active", item.id)
    source.dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.navigate, {
      bubbles: true,
      detail: Object.freeze({kind: "secondary", id: item.id, route: item.route}),
    }))
  }
  const onScenario = (item: WorkbenchScenarioItem, source: HTMLElement): void => {
    update("scenarios.active", item.id)
    source.dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.scenario, {
      bubbles: true,
      detail: Object.freeze({id: item.id}),
    }))
  }
  const onInspectorCategoryChange = (id: string): void => {
    const retained = retainedWorkbenchInspectorState(state, inspectorStateBySubject)
    if (retained === null || !activeWorkbenchInspectorWidgets(state).some(widget => widget.id === id)) return
    retained.selectedId = id
    rerender()
  }
  const onInspectorQueryChange = (query: string): void => {
    const retained = retainedWorkbenchInspectorState(state, inspectorStateBySubject)
    if (retained === null) return
    retained.query = query
    rerender()
  }
  const onInspectorToggle = (id: string, expanded: boolean): void => {
    const retained = retainedWorkbenchInspectorState(state, inspectorStateBySubject)
    if (retained === null || !activeWorkbenchInspectorWidgets(state).some(widget => widget.id === id)) return
    retained.expanded.set(id, expanded)
    rerender()
  }

  const renderState = (candidate: WorkbenchViewState): void => {
    const inspector = projectWorkbenchInspector(
      candidate,
      inspectorStateBySubject,
      onInspectorToggle,
    )
    componentRoot.render(WorkbenchView as any, {
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
      children: inspector.panels,
    })
  }
  rerender = () => renderState(state)
  rerender()
  const element = exactWorkbenchElement(
    staging,
    "[data-storybook-workbench]",
    "Workbench root",
  ) as HTMLDivElement
  const elements = readWorkbenchElements(element)
  parent?.appendChild(element)
  componentRoot.flush()
  syncWorkbenchPresentation(null, state.presentation, elements, document)

  const read = <Address extends WorkbenchAddress>(
    address: Address,
  ): WorkbenchAddressMap[Address] => {
    assertActive(disposed)
    return state[address as keyof WorkbenchViewState] as WorkbenchAddressMap[Address]
  }

  const update = <Address extends WorkbenchAddress>(
    address: Address,
    value: WorkbenchAddressMap[Address],
  ): void => {
    assertActive(disposed)
    const previousPresentation = state.presentation
    const next = updateWorkbenchState(state, address, value, document)
    renderState(next)
    state = next
    syncWorkbenchPresentation(previousPresentation, next.presentation, elements, document)
  }

  const present = (value: WorkbenchPresentationUpdate): void => {
    assertActive(disposed)
    const presentation = validateWorkbenchPresentation(value?.presentation, document)
    const subject = validateWorkbenchInspectorSubject(
      value?.inspectorSubject,
      state["inspector.registry"],
    )
    const values = validateWorkbenchInspectorValues(value?.inspectorValues)
    const next: WorkbenchViewState = {
      ...state,
      "preview.label": requiredText("Preview label", value?.label),
      presentation,
      "inspector.subject": subject,
      "inspector.values": values,
    }
    const previousPresentation = state.presentation
    renderState(next)
    state = next
    syncWorkbenchPresentation(previousPresentation, presentation, elements, document)
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const node = state.presentation.node
    if (node !== null && node.parentNode !== null) node.parentNode.removeChild(node)
    componentRoot.unmount()
    if (element.parentNode !== null) element.parentNode.removeChild(element)
  }

  const controller: WorkbenchController = Object.freeze({read, update, present, dispose})
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

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("Workbench is disposed")
}
