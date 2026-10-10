import {iconSvg} from "@zavx0z/immersive/ui/icons"
import {Inspector} from "@zavx0z/immersive/ui"
import type {ImmersiveUiComponentWidgetInspector} from "@zavx0z/immersive/ui"
type InspectorCategory = ImmersiveUiComponentWidgetInspector.Input["categories"][number]
import {ChatSessionHeader} from "./chat-header"
import type {WorkbenchChatContext} from "../../contract/workbench"
import type {JSX} from "@zavx0z/immersive/XReact"
import type {
  WorkbenchInspectorSubject,
  WorkbenchInspectorWidgetRegistration,
} from "../types.ts"

const branchIcon = iconSvg('<circle cx="6" cy="5" r="2"/><circle cx="18" cy="11" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v12h10M6 11h10"/>')

export type WorkbenchInspectorProps = Readonly<{
  registry: readonly WorkbenchInspectorWidgetRegistration[]
  subject: WorkbenchInspectorSubject | null
  selectedId: string
  query: string
  chatContext?: WorkbenchChatContext | undefined
  onCategoryChange(id: string): void
  onQueryChange(query: string): void
  children: JSX.Element | readonly JSX.Element[]
}>

/** Единственный production Inspector в фиксированной раскладке Workbench. */
export function WorkbenchInspector(props: WorkbenchInspectorProps) {
  const registrations = props.subject === null
    ? Object.freeze([]) as readonly WorkbenchInspectorWidgetRegistration[]
    : Object.freeze(props.subject.widgetIds.map(id => props.registry.find(widget => widget.id === id)!))
  const categories: readonly InspectorCategory[] = Object.freeze([...registrations.map(widget => Object.freeze({
    id: widget.id,
    label: widget.label,
    iconSrc: widget.iconSrc,
    title: widget.title,
    panelIds: Object.freeze([widget.id]),
  })), {
    id: "tree",
    label: "Ветка",
    title: "Ветка",
    iconSrc: branchIcon,
    panelIds: ["tree"],
  }])
  return <Inspector
    ariaLabel="Инспектор"
    categoriesLabel="Панели"
    categories={categories}
    selectedCategoryId={props.selectedId}
    query={props.query}
    showSearch={props.selectedId !== "chat" && props.selectedId !== "tree"}
    searchLabel="Поиск по инспектору"
    searchPlaceholder="Поиск…"
    onCategoryChange={props.onCategoryChange}
    onQueryChange={props.onQueryChange}
  >
    {props.selectedId === "chat" && props.chatContext ? <ChatSessionHeader
      slot="header"
      context={props.chatContext}
    /> : null}
    {props.children}
  </Inspector>
}
