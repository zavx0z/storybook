import {Panel} from "@zavx0z/ui/surfaces/panel"
import {useRef} from "@zavx0z/component"
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
  active: boolean
}>) {
  const activated = useRef(false)
  if (props.active) activated.current = true
  const showContent = activated.current
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
    {showContent && source ? <SourceWidget value={props.value} /> : null}
    {showContent && !source ? <ValueFields value={props.value} /> : null}
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
      active={!props.hidden && props.expanded}
    />
  </Panel>
}

/** Содержимое widget со своей шапкой, без дополнительной сворачиваемой панели. */
export function CustomWidgetContent(props: WidgetPanelProps & Readonly<{
  children: JsxSourceElement
}>) {
  return <div
    hidden={props.hidden}
    style={css`
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      width: 100%;

      &[hidden] {
        display: none;
      }
    `}
  >
    {props.children}
  </div>
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
