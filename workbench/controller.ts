/** One compiled six-region Storybook Workbench controller. */

import {
  CustomEvent,
  Document,
  type HTMLDivElement,
  type HTMLElement,
} from "@zavx0z/dom"
import {createRoot} from "@zavx0z/component"
import type {
  CreateWorkbenchOptions,
  Workbench,
  WorkbenchAddress,
  WorkbenchAddressMap,
  WorkbenchBreadcrumb,
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
  validateWorkbenchProjectionHosts,
} from "./presentation.ts"
import {
  createInitialWorkbenchState,
  updateWorkbenchState,
} from "./state.ts"
import {requiredText} from "./validation.ts"
import {WorkbenchView, type WorkbenchViewProps} from "./view.tsx"

/**
Создаёт состояние Workbench в переданном Document приложения.

Авторский TSX использует нативный тип Document, а компилятор связывает его с
semantic Document. Здесь проверяется фактический владелец перед использованием
внутренних API. Отдельный компонентный корень или native Document не создаётся.

@throws TypeError При передаче браузерного Document вместо Document приложения.
*/
export function createWorkbenchModel(options: Omit<CreateWorkbenchOptions, "document"> & Readonly<{document: Document | globalThis.Document}>) {
  const {document} = options
  if (!(document instanceof Document)) throw new TypeError("Workbench requires the application's semantic Document")
  const parent = options.parent
  if (parent !== undefined) assertNodeInDocument(parent, document, "Workbench parent")
  let projectionHosts = validateWorkbenchProjectionHosts(options.projectionHosts, document)
  let disposed = false
  let state = createInitialWorkbenchState(options.initial, document)
  const inspectorStateBySubject = new Map<string, WorkbenchInspectorRetainedState>()
  const listeners = new Set<() => void>()
  let snapshot!: WorkbenchViewProps
  let element!: HTMLDivElement
  let elements!: Workbench["elements"]
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
  const onStatusNavigate = (item: WorkbenchBreadcrumb, source: HTMLElement): void => {
    source.dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.navigate, {
      bubbles: true,
      detail: Object.freeze({
        kind: "breadcrumb",
        id: item.id,
        route: item.route,
        ...(item.urlPath === undefined ? {} : {urlPath: item.urlPath}),
      }),
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
    snapshot = {
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
      onStatusNavigate,
      children: inspector.panels,
    } as unknown as WorkbenchViewProps
    for (const listener of [...listeners]) listener()
  }
  rerender = () => renderState(state)
  rerender()

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
    state = next
    renderState(next)
    if (elements !== undefined) syncWorkbenchPresentation(
      previousPresentation,
      next.presentation,
      elements,
      document,
      projectionHosts,
    )
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
    if (elements !== undefined) syncWorkbenchPresentation(previousPresentation, presentation, elements, document, projectionHosts)
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const node = state.presentation.node
    if (node !== null && node.parentNode !== null) node.parentNode.removeChild(node)
    listeners.clear()
  }

  const controller: WorkbenchController = Object.freeze({read, update, present, dispose})
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    bind(target: HTMLDivElement, hosts = options.projectionHosts): Workbench {
      element = target
      elements = readWorkbenchElements(element)
      projectionHosts = validateWorkbenchProjectionHosts(hosts, document)
      syncWorkbenchPresentation(null, state.presentation, elements, document, projectionHosts)
      return {document, element, elements, controller, update, present, dispose}
    },
    dispose,
  })
}

/** Standalone fixture adapter around the same declarative Workbench model/view. */
export function createWorkbench(options: CreateWorkbenchOptions) {
  const model = createWorkbenchModel(options)
  const staging = options.document.createDocumentFragment()
  const componentRoot = createRoot(staging, {identifierPrefix: "storybook-workbench"})
  const render = () => componentRoot.render(WorkbenchView as any, model.getSnapshot())
  const unsubscribe = model.subscribe(render)
  render()
  const element = exactWorkbenchElement(staging, "[data-storybook-workbench]", "Workbench root") as HTMLDivElement
  options.parent?.appendChild(element)
  componentRoot.flush()
  const workbench = model.bind(element)
  return {
    ...workbench,
    componentRoot,
    dispose() {
      unsubscribe()
      model.dispose()
      componentRoot.unmount()
      element.parentNode?.removeChild(element)
    },
  }
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("Workbench is disposed")
}
