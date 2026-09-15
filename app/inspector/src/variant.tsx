import {Panel} from "@zavx0z/ui/surfaces/panel"
import {Typography} from "@zavx0z/ui/typography"
import type {ScenarioApp} from "../../contract/output"

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
export function ScenarioVariant(props: Readonly<{key?: string; app: ScenarioApp; variant: Variant; expanded: boolean}>) {
  return <Panel
    label={props.variant.title}
    title={props.variant.title}
    expanded={props.expanded}
    onToggle={expanded => { if (expanded) props.app.select(props.variant.id) }}
  >
    <ScenarioPoints variant={props.variant} />
  </Panel>
}
