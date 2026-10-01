import {
  component,
  keyedComponents,
  type KeyedComponentsValue,
} from "@zavx0z/component"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {WorkbenchViewState} from "../contract.ts"
import {activeWorkbenchInspectorWidgets} from "./registry.ts"
import {
  CustomWidgetPanel,
  CustomWidgetContent,
  StandardWidgetPanel,
} from "./widget-panel.tsx"

export type WorkbenchInspectorRetainedState = {
  selectedId: string
  query: string
  expanded: Map<string, boolean>
  treeExpanded: Map<string, readonly string[]>
}

export function projectWorkbenchInspector(
  state: WorkbenchViewState,
  retainedBySubject: Map<string, WorkbenchInspectorRetainedState>,
  onToggle: (id: string, expanded: boolean) => void,
  onExpandedChange: (id: string, keys: readonly string[]) => void,
): Readonly<{
  selectedId: string
  query: string
  panels: KeyedComponentsValue
}> {
  const widgets = activeWorkbenchInspectorWidgets(state)
  const retained = retainedWorkbenchInspectorState(state, retainedBySubject)
  const selectedId = retained?.selectedId ?? ""
  const query = retained?.query ?? ""
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU")
  const panels = widgets.map(widget => {
    const hidden = widget.id !== selectedId || normalizedQuery.length > 0 &&
      !`${widget.id} ${widget.title}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery)
    const panelProps = {
      widget,
      value: state["inspector.values"][widget.id],
      expanded: retained?.expanded.get(widget.id) ?? true,
      hidden,
      onToggle,
    }
    if (widget.kind !== "custom") {
      return component(
        StandardWidgetPanel as unknown as CompiledTemplate<typeof panelProps>,
        panelProps,
        widget.id,
      )
    }
    const child = component(widget.component, Object.freeze({
      value: state["inspector.values"][widget.id],
      expandedKeys: retained?.treeExpanded.get(widget.id) ?? Object.freeze([]),
      onExpandedChange(keys) {
        onExpandedChange(widget.id, keys)
      },
    }), `${widget.id}:value`)
    return component(
      (widget.wrapInPanel === false ? CustomWidgetContent : CustomWidgetPanel) as unknown as CompiledTemplate<
        typeof panelProps & Readonly<{children: typeof child}>
      >,
      {...panelProps, children: child},
      widget.id,
    )
  })
  return Object.freeze({selectedId, query, panels: keyedComponents(panels)})
}

export function retainedWorkbenchInspectorState(
  state: WorkbenchViewState,
  retainedBySubject: Map<string, WorkbenchInspectorRetainedState>,
): WorkbenchInspectorRetainedState | null {
  const subject = state["inspector.subject"]
  if (subject === null) return null
  const widgets = activeWorkbenchInspectorWidgets(state)
  const key = `${subject.packageId}\0${subject.workspaceId ?? subject.subjectId}`
  let retained = retainedBySubject.get(key)
  if (retained === undefined) {
    retained = {
      selectedId: widgets[0]?.id ?? "",
      query: "",
      expanded: new Map(),
      treeExpanded: new Map(),
    }
    retainedBySubject.set(key, retained)
  } else {
    const current = retained
    if (!widgets.some(widget => widget.id === current.selectedId)) {
      current.selectedId = widgets[0]?.id ?? ""
    }
  }
  return retained
}
