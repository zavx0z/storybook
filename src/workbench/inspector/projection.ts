import {
  component,
  keyedComponents,
  type KeyedComponentsValue,
} from "@zavx0z/react"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {WorkbenchViewState} from "../contract.ts"
import {activeWorkbenchInspectorWidgets} from "./registry.ts"
import {
  CustomWidgetSection,
  StandardWidgetSection,
} from "./widget-section.tsx"

export type WorkbenchInspectorRetainedState = {
  selectedId: string
  query: string
  expanded: Map<string, boolean>
}

export function projectWorkbenchInspector(
  state: WorkbenchViewState,
  retainedBySubject: Map<string, WorkbenchInspectorRetainedState>,
  onToggle: (id: string, expanded: boolean) => void,
): Readonly<{
  selectedId: string
  query: string
  sections: KeyedComponentsValue
}> {
  const widgets = activeWorkbenchInspectorWidgets(state)
  const retained = retainedWorkbenchInspectorState(state, retainedBySubject)
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
      CustomWidgetSection as unknown as CompiledTemplate<
        typeof sectionProps & Readonly<{children: typeof child}>
      >,
      {...sectionProps, children: child},
      widget.id,
    )
  })
  return Object.freeze({selectedId, query, sections: keyedComponents(sections)})
}

export function retainedWorkbenchInspectorState(
  state: WorkbenchViewState,
  retainedBySubject: Map<string, WorkbenchInspectorRetainedState>,
): WorkbenchInspectorRetainedState | null {
  const subject = state["inspector.subject"]
  if (subject === null) return null
  const widgets = activeWorkbenchInspectorWidgets(state)
  const key = `${subject.packageId}\0${subject.subjectId}`
  let retained = retainedBySubject.get(key)
  if (retained === undefined) {
    retained = {selectedId: widgets[0]?.id ?? "", query: "", expanded: new Map()}
    retainedBySubject.set(key, retained)
  } else {
    const current = retained
    if (!widgets.some(widget => widget.id === current.selectedId)) {
      current.selectedId = widgets[0]?.id ?? ""
    }
  }
  return retained
}
