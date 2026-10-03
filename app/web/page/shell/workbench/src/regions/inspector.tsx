import type {JSX} from "@jsx-compiler/session"
import type {
  WorkbenchInspectorSubject,
  WorkbenchInspectorWidgetRegistration,
} from "../types.ts"
import {WorkbenchInspector} from "../inspector/panel.tsx"

export type InspectorRegionProps = Readonly<{
  registry: readonly WorkbenchInspectorWidgetRegistration[]
  subject: WorkbenchInspectorSubject | null
  selectedId: string
  query: string
  onCategoryChange(id: string): void
  onQueryChange(query: string): void
  children: readonly JSX.Element[]
}>

/** Фиксированная область с одним production Inspector. */
export function InspectorRegion(props: InspectorRegionProps) {
  return <div
    data-storybook-region="inspector"
    style={css`
      display: flex;
      flex: 0 0 400px;
      width: 400px;
      min-height: 0;
      overflow: clip;
    `}
  >
    <WorkbenchInspector
      registry={props.registry}
      subject={props.subject}
      selectedId={props.selectedId}
      query={props.query}
      onCategoryChange={props.onCategoryChange}
      onQueryChange={props.onQueryChange}
    >{props.children}</WorkbenchInspector>
  </div>
}
