import {
  InspectorSection,
} from "@ui/components/inspector"
import type {JsxSourceElement} from "@zavx0z/template/jsx-runtime"
import type {WorkbenchInspectorWidgetRegistration} from "../contract.ts"
import {SourceWidget} from "./source-widget.tsx"
import {ValueFields} from "./value-fields.tsx"

export type WidgetSectionProps = Readonly<{
  widget: WorkbenchInspectorWidgetRegistration
  value: unknown
  expanded: boolean
  hidden: boolean
  onToggle(id: string, expanded: boolean): void
}>

function StandardWidgetSectionContent(props: Readonly<{
  widget: WorkbenchInspectorWidgetRegistration
  value: unknown
}>) {
  const source = props.widget.kind === "source"
  return <div
    data-widget-kind={props.widget.kind}
    style={css`
      & {
        display: flex;
        flex-direction: column;
        width: 100%;
        min-height: 0;
      }
    `}
  >
    {source ? <SourceWidget value={props.value} /> : null}
    {!source ? <ValueFields value={props.value} /> : null}
  </div>
}

export function StandardWidgetSection(props: WidgetSectionProps) {
  const onToggle = (id: string, expanded: boolean) => props.onToggle(id, expanded)
  return <InspectorSection
    id={props.widget.id}
    label={props.widget.title}
    title={props.widget.title}
    expanded={props.expanded}
    hidden={props.hidden}
    onToggle={onToggle}
  >
    <StandardWidgetSectionContent widget={props.widget} value={props.value} />
  </InspectorSection>
}

export function CustomWidgetSection(props: WidgetSectionProps & Readonly<{
  children: JsxSourceElement
}>) {
  const onToggle = (id: string, expanded: boolean) => props.onToggle(id, expanded)
  return <InspectorSection
    id={props.widget.id}
    label={props.widget.title}
    title={props.widget.title}
    expanded={props.expanded}
    hidden={props.hidden}
    onToggle={onToggle}
  >{props.children}</InspectorSection>
}
