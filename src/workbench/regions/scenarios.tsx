import {Button, type ButtonProps} from "@ui/components/button"
import type {WorkbenchScenarioItem} from "../contract.ts"

type ScenarioButtonProps = Readonly<{
  item: WorkbenchScenarioItem
  selected: boolean
  onScenario(item: WorkbenchScenarioItem, source: HTMLElement): void
}>

export type ScenariosRegionProps = Readonly<{
  label: string
  items: readonly WorkbenchScenarioItem[]
  activeId: string | null
  onScenario(item: WorkbenchScenarioItem, source: HTMLElement): void
}>

function ScenarioButton(props: ScenarioButtonProps) {
  const onClick: NonNullable<ButtonProps["onClick"]> = event => {
    if (!props.item.disabled) props.onScenario(props.item, event.currentTarget)
  }
  return <Button
    label={props.item.label}
    title={props.item.title ?? props.item.label}
    aria-label={props.item.label}
    disabled={props.item.disabled === true}
    selected={props.selected}
    style={css`
      width: auto;
      min-width: 72px;
    `}
    onClick={onClick}
  />
}

/** Variant/scenario toolbar for the selected subject. */
export function ScenariosRegion(props: ScenariosRegionProps) {
  return <section
    role="toolbar"
    data-storybook-region="scenarios"
    aria-label={props.label}
    style={css`
      display: flex;
      width: 100%;
      height: 28px;
      min-height: 28px;
    `}
  >
    <div
      data-storybook-part="scenario-items"
      style={css`
        box-sizing: border-box;
        display: flex;
        flex-direction: row;
        width: 100%;
        min-width: 0;
        height: 28px;
        gap: 2px;
        padding: 2px 4px;
        overflow: clip;
      `}
    >
      {props.items.map(item => <ScenarioButton
        key={item.id}
        item={item}
        selected={item.id === props.activeId}
        onScenario={props.onScenario}
      />)}
    </div>
  </section>
}
