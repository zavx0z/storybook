import {Panel} from "@ui/components/panel"
import type {JsxSourceElement} from "@zavx0z/template/jsx-runtime"
import type {WorkbenchInspectorWidgetRegistration} from "../contract.ts"
import {SourceWidget} from "./source-widget.tsx"
import {ValueFields} from "./value-fields.tsx"

export type WidgetPanelProps = Readonly<{
  widget: WorkbenchInspectorWidgetRegistration
  value: unknown
  expanded: boolean
  hidden: boolean
  onToggle(id: string, expanded: boolean): void
}>

function StandardWidgetPanelContent(props: Readonly<{
  widget: WorkbenchInspectorWidgetRegistration
  value: unknown
}>) {
  const source = props.widget.kind === "source"
  return <div
    data-widget-kind={props.widget.kind}
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 0;
    `}
  >
    {source ? <SourceWidget value={props.value} /> : null}
    {!source ? <ValueFields value={props.value} /> : null}
  </div>
}

export function StandardWidgetPanel(props: WidgetPanelProps) {
  const onToggle = (expanded: boolean, _event: Event) => props.onToggle(props.widget.id, expanded)
  return <Panel
    label={props.widget.title}
    title={props.widget.title}
    expanded={props.expanded}
    hidden={props.hidden}
    onToggle={onToggle}
  >
    <StandardWidgetPanelContent
      widget={props.widget}
      value={props.value}
    />
  </Panel>
}

export function CustomWidgetPanel(props: WidgetPanelProps & Readonly<{
  children: JsxSourceElement
}>) {
  const onToggle = (expanded: boolean, _event: Event) => props.onToggle(props.widget.id, expanded)
  return <Panel
    label={props.widget.title}
    title={props.widget.title}
    expanded={props.expanded}
    hidden={props.hidden}
    onToggle={onToggle}
  >
    {props.children}
  </Panel>
}
