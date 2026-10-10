import type {DOMComponentConstructor, DOMConstruction} from "@zavx0z/immersive"
import type {WorkbenchInspectorCustomWidgetProps, WorkbenchViewState} from "../../contract/workbench.ts"
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
  panels: readonly DOMConstruction<any>[]
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
      return {
        type: StandardWidgetPanel as unknown as DOMComponentConstructor<typeof panelProps>,
        props: panelProps,
        key: widget.id,
      }
    }
    const child: DOMConstruction<WorkbenchInspectorCustomWidgetProps> = {
      type: widget.component,
      props: Object.freeze({
        value: state["inspector.values"][widget.id],
        expandedKeys: retained?.treeExpanded.get(widget.id) ?? Object.freeze([]),
        onExpandedChange(keys) {
          onExpandedChange(widget.id, keys)
        },
      }),
      key: `${widget.id}:value`,
    }
    return {
      type: (widget.wrapInPanel === false ? CustomWidgetContent : CustomWidgetPanel) as unknown as DOMComponentConstructor<typeof panelProps>,
      props: panelProps,
      key: widget.id,
      content: {"": child},
    }
  })
  return Object.freeze({selectedId, query, panels})
}

export function retainedWorkbenchInspectorState(
  state: WorkbenchViewState,
  retainedBySubject: Map<string, WorkbenchInspectorRetainedState>,
): WorkbenchInspectorRetainedState | null {
  const subject = state["inspector.subject"]
  const widgets = activeWorkbenchInspectorWidgets(state)
  const key = subject === null ? "" : `${subject.packageId ?? ""}\0${subject.workspaceId ?? subject.subjectId}`
  let retained = retainedBySubject.get(key)
  if (retained === undefined) {
    retained = {
      selectedId: widgets[0]?.id ?? "tree",
      query: "",
      expanded: new Map(),
      treeExpanded: new Map(),
    }
    retainedBySubject.set(key, retained)
  } else {
    const current = retained
    if (current.selectedId !== "tree" && !widgets.some(widget => widget.id === current.selectedId)) {
      current.selectedId = widgets[0]?.id ?? "tree"
    }
  }
  return retained
}
