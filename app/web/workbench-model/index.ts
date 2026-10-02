/**
Владеет общей моделью рабочей области, атомарной публикацией содержимого
и состоянием секций Inspector. Действия разных поверхностей проходят через
один каталог и semantic события того же Document; освобождение модели
удаляет её представление и подписки, сохраняя Browser Root у приложения.

@packageDocumentation
*/
import {WORKBENCH_LAYOUT_PROTOCOL, WORKBENCH_REGIONS} from "./src/events"
import {WORKBENCH_STANDARD_WIDGET_REGISTRY, WORKBENCH_CHAT_WIDGET, withWorkbenchChat} from "./src/inspector/registry"
import {
  CustomEvent,
  Document,
  type HTMLDivElement,
  type HTMLElement,
} from "@zavx0z/dom"
import type {
  Workbench,
  WorkbenchAddress,
  WorkbenchCatalogAction,
  WorkbenchAddressMap,
  WorkbenchBreadcrumb,
  WorkbenchController,
  WorkbenchNavigationGroup,
  WorkbenchNavigationItem,
  WorkbenchPresentationUpdate,
  WorkbenchTabItem,
  WorkbenchViewState,
} from "./contract/workbench.ts"
import {WORKBENCH_EVENTS} from "./src/events"
import {
  readWorkbenchElements,
} from "./src/elements.ts"
import {
  projectWorkbenchInspector,
  retainedWorkbenchInspectorState,
  type WorkbenchInspectorRetainedState,
} from "./src/inspector/projection.ts"
import {activeWorkbenchInspectorWidgets} from "./src/inspector/registry.ts"
import {
  validateWorkbenchInspectorSubject,
  validateWorkbenchInspectorValues,
} from "./src/inspector/registry.ts"
import {
  assertNodeInDocument,
  syncWorkbenchPresentation,
  validateWorkbenchPresentation,
  validateWorkbenchProjectionHosts,
} from "./src/presentation.ts"
import {
  createInitialWorkbenchState,
  updateWorkbenchState,
} from "./src/state.ts"
import {requiredText, assertActive} from "./src/validation.ts"
import type {WorkbenchViewProps} from "./contract/view"
import type {WebWorkbenchModel} from "./contract"
export type {WebWorkbenchModel} from "./contract"

/**
Создаёт состояние Workbench в переданном Document приложения.

Авторский TSX использует нативный тип Document, а компилятор связывает его с
semantic Document. Здесь проверяется фактический владелец перед использованием
внутренних API. Отдельный компонентный корень или native Document не создаётся.

@throws TypeError При передаче браузерного Document вместо Document приложения.
*/
function createWorkbenchModel(options: WebWorkbenchModel.Input): WebWorkbenchModel.Output {
  const {document} = options
  if (!(document instanceof Document)) throw new TypeError("Workbench requires the application's semantic Document")
  const parent = options.parent
  if (parent !== undefined) assertNodeInDocument(parent, document, "Workbench parent")
  let projectionHosts = validateWorkbenchProjectionHosts(options.projectionHosts, document)
  let disposed = false
  let state = createInitialWorkbenchState(options.initial, document)
  const inspectorStateBySubject = new Map<string, WorkbenchInspectorRetainedState>((options.userState?.inspector ?? []).map(item => [item.subject, {
    selectedId: item.selectedId, query: item.query,
    expanded: new Map(item.expanded), treeExpanded: new Map(item.treeExpanded),
  }]))
  const listeners = new Set<() => void>()
  let snapshot!: WorkbenchViewProps
  let element!: HTMLDivElement
  let elements!: Workbench["elements"]
  let rerender = (): void => {}

  /** События HUD проходят через тот же Workbench, на который подписана маршрутизация. */
  const catalogEventTarget = (source: HTMLElement): HTMLElement =>
    element !== undefined && !element.contains(source) ? element : source

  const onCatalogNavigate = (item: WorkbenchNavigationItem, source: HTMLElement): void => {
    update("catalog.active", item.id)
    catalogEventTarget(source).dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.navigate, {
      bubbles: true,
      detail: Object.freeze({kind: "catalog", id: item.id, route: item.route}),
    }))
  }
  const onCatalogAction = (action: WorkbenchCatalogAction, source: HTMLElement): void => {
    catalogEventTarget(source).dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.catalogAction, {bubbles: true, detail: Object.freeze({...action})}))
  }
  const onCatalogSearch = (value: string, source: HTMLElement): void => {
    update("catalog.search", value)
    catalogEventTarget(source).dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.search, {
      bubbles: true,
      detail: Object.freeze({value}),
    }))
  }
  const onGroupToggle = (
    group: WorkbenchNavigationGroup,
    collapsed: boolean,
    source: HTMLElement,
  ): void => {
    catalogEventTarget(source).dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.groupToggle, {
      bubbles: true,
      detail: Object.freeze({kind: "catalog", id: group.id, collapsed}),
    }))
  }
  const onTab = (item: WorkbenchTabItem, source: HTMLElement): void => {
    update("tabs.active", item.id)
    source.dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.tab, {
      bubbles: true,
      detail: Object.freeze({id: item.id, route: item.route}),
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
    element.dispatchEvent(new CustomEvent(WORKBENCH_EVENTS.inspector, {
      bubbles: true,
      detail: Object.freeze({id}),
    }))
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
  const onInspectorExpandedChange = (id: string, keys: readonly string[]): void => {
    const retained = retainedWorkbenchInspectorState(state, inspectorStateBySubject)
    if (retained === null || !activeWorkbenchInspectorWidgets(state).some(widget => widget.id === id)) return
    retained.treeExpanded.set(id, Object.freeze([...keys]))
    rerender()
  }

  const renderState = (candidate: WorkbenchViewState): void => {
    const inspector = projectWorkbenchInspector(
      candidate,
      inspectorStateBySubject,
      onInspectorToggle,
      onInspectorExpandedChange,
    )
    snapshot = {
      document,
      state: candidate,
      navigationExpansion: options.navigationExpansion,
      inspectorSelectedId: inspector.selectedId,
      inspectorQuery: inspector.query,
      onCatalogNavigate,
      onCatalogAction,
      onCatalogSearch,
      onGroupToggle,
      onTab,
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

  /**
  Выбирает доступную секцию текущего Inspector без смены Preview маршрута.

  Runtime восстанавливает этот выбор из URL после публикации presentation;
  `null` возвращает первое доступное значение рабочего пространства.
  */
  const selectInspector = (id: string | null): void => {
    assertActive(disposed)
    const retained = retainedWorkbenchInspectorState(state, inspectorStateBySubject)
    if (retained === null) return
    const widgets = activeWorkbenchInspectorWidgets(state)
    const selected = id === null ? widgets[0]?.id ?? "" : id
    if (!widgets.some(widget => widget.id === selected)) return
    retained.selectedId = selected
    rerender()
  }

  /** Возвращает retained выбор активного рабочего пространства Inspector. */
  const selectedInspector = (): string | null => {
    assertActive(disposed)
    return retainedWorkbenchInspectorState(state, inspectorStateBySubject)?.selectedId || null
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const node = state.presentation.node
    if (node !== null && node.parentNode !== null) node.parentNode.removeChild(node)
    listeners.clear()
  }

  const controller: WorkbenchController = Object.freeze({read, update, present, selectedInspector, selectInspector, dispose,
    captureUserState() {
      return {inspector: [...inspectorStateBySubject].map(([subject, value]) => ({subject,
        selectedId: value.selectedId, query: value.query, expanded: [...value.expanded],
        treeExpanded: [...value.treeExpanded].map(([key, values]) => [key, [...values]] as const),
      }))}
    },
  })
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
      return {document, element, elements, controller, update, present, selectedInspector, selectInspector, dispose}
    },
    dispose,
  })
}

export default Object.assign(createWorkbenchModel, {
  events: WORKBENCH_EVENTS,
  layoutProtocol: WORKBENCH_LAYOUT_PROTOCOL,
  regions: WORKBENCH_REGIONS,
  standardWidgets: WORKBENCH_STANDARD_WIDGET_REGISTRY,
  chatWidget: WORKBENCH_CHAT_WIDGET,
  withChat: withWorkbenchChat,
})
