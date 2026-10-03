import {Inspector} from "@zavx0z/ui"
import type {UiWidgetsInspector} from "@zavx0z/ui"
type InspectorCategory = UiWidgetsInspector.Input["categories"][number]
import type {JSX} from "@jsx-compiler/session"
import type {
  WorkbenchInspectorSubject,
  WorkbenchInspectorWidgetRegistration,
} from "../types.ts"

export type WorkbenchInspectorProps = Readonly<{
  registry: readonly WorkbenchInspectorWidgetRegistration[]
  subject: WorkbenchInspectorSubject | null
  selectedId: string
  query: string
  onCategoryChange(id: string): void
  onQueryChange(query: string): void
  children: readonly JSX.Element[]
}>

/** Единственный production Inspector в фиксированной раскладке Workbench. */
export function WorkbenchInspector(props: WorkbenchInspectorProps) {
  const registrations = props.subject === null
    ? Object.freeze([]) as readonly WorkbenchInspectorWidgetRegistration[]
    : Object.freeze(props.subject.widgetIds.map(id => props.registry.find(widget => widget.id === id)!))
  const categories: readonly InspectorCategory[] = Object.freeze(registrations.map(widget => Object.freeze({
    id: widget.id,
    label: widget.label,
    iconSrc: widget.iconSrc,
    title: widget.title,
    panelIds: Object.freeze([widget.id]),
  })))
  return <Inspector
    ariaLabel="Инспектор"
    categoriesLabel="Панели"
    categories={categories}
    selectedCategoryId={props.selectedId}
    query={props.query}
    searchLabel="Поиск по инспектору"
    searchPlaceholder="Поиск…"
    onCategoryChange={props.onCategoryChange}
    onQueryChange={props.onQueryChange}
  >
    {props.children}
  </Inspector>
}
