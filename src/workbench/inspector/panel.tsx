import {
  Inspector,
  type InspectorCategory,
} from "@zavx0z/ui/widgets/inspector"
import {resourceIcon} from "@zavx0z/ui/themes/icons"
import type {JsxSourceElement} from "@zavx0z/template/jsx-runtime"
import type {
  WorkbenchInspectorSubject,
  WorkbenchInspectorWidgetRegistration,
} from "../contract.ts"

export type WorkbenchInspectorProps = Readonly<{
  registry: readonly WorkbenchInspectorWidgetRegistration[]
  subject: WorkbenchInspectorSubject | null
  selectedId: string
  query: string
  onCategoryChange(id: string): void
  onQueryChange(query: string): void
  children: readonly JsxSourceElement[]
}>

/** The one production Inspector owned by the fixed Workbench layout. */
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
    context={props.subject === null ? undefined : {
      label: `${props.subject.packageId} · ${props.subject.subjectId}`,
      iconSrc: resourceIcon,
      title: `${props.subject.packageId}/${props.subject.subjectId}`,
    }}
    onCategoryChange={props.onCategoryChange}
    onQueryChange={props.onQueryChange}
  >
    {props.children}
  </Inspector>
}
