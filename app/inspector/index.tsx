import {useSyncExternalStore} from "@zavx0z/component"
import {CodeEditor} from "@zavx0z/ui/views/code-editor"
import {Panel} from "@zavx0z/ui/surfaces/panel"
import {Typography} from "@zavx0z/ui/typography"
import type {ScenarioApp} from "../contract/output"

/** Вариант и его пункты из подготовленного снимка сценария. */
type Variant = ScenarioApp["variants"][number]

/** Один пункт документации раскрытого варианта. */
function ScenarioPoint(props: Readonly<{key?: string; point: Variant["points"][number]}>) {
  return <section style={css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `}>
    <Typography text={props.point.title} />
    {props.point.content ? <Typography text={props.point.content} variant="caption" /> : null}
  </section>
}

/** Пункты передаются в Panel как компонент с собственной разметкой. */
function ScenarioPoints(props: Readonly<{variant: Variant}>) {
  return <div style={css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `}>
    {props.variant.points.map((point, index) => <ScenarioPoint key={String(index)} point={point} />)}
  </div>
}

/** Управляемая секция: открытие выбирает вариант в общем состоянии App. */
function ScenarioVariant(props: Readonly<{key?: string; app: ScenarioApp; variant: Variant; expanded: boolean}>) {
  return <Panel
    label={props.variant.title}
    title={props.variant.title}
    expanded={props.expanded}
    onToggle={expanded => { if (expanded) props.app.select(props.variant.id) }}
  >
    <ScenarioPoints variant={props.variant} />
  </Panel>
}

/** Один Editor с декларацией и аккордеон пунктов выбранного варианта. */
export function ScenarioInspector(props: Readonly<{value: unknown}>) {
  const app = props.value as ScenarioApp
  const selected = useSyncExternalStore(app.subscribe, app.getSnapshot)
  return <section
    data-scenario-inspector=""
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
      gap: 6px;
    `}
  >
    <CodeEditor
      title="Декларация компонента"
      languageId="typescript"
      readOnly={true}
      value={selected.source}
      style={css`
        width: 100%;
        height: 260px;
        min-height: 180px;
      `}
    />
    {app.variants.map(variant => <ScenarioVariant
      key={variant.id}
      app={app}
      variant={variant}
      expanded={selected.id === variant.id}
    />)}
  </section>
}
