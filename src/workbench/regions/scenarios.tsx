import {Button} from "@ui/components/button"
import type {Event, HTMLElement} from "@zavx0z/dom"
import {WorkbenchRegionHeading} from "../components/region-heading.tsx"
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
  const onClick = (event: Event) => {
    if (!props.item.disabled) props.onScenario(props.item, event.currentTarget as HTMLElement)
  }
  return <Button
    label={props.item.label}
    title={props.item.title ?? props.item.label}
    aria-label={props.item.label}
    disabled={props.item.disabled === true}
    selected={props.selected}
    style={css`
      & {
        width: auto;
        min-width: 72px;
      }
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
      & {
        display: flex;
        width: 100%;
        height: 28px;
        min-height: 28px;
      }
    `}
  >
    <div style={css`
      & {
        display: flex;
        flex-direction: row;
        width: 100%;
        height: 28px;
        gap: 4px;
        padding: 2px 4px;
        overflow: clip;
      }
    `}>
      <div style={css`
        & {
          display: flex;
          flex-direction: row;
          width: 100%;
          min-width: 0;
          gap: 4px;
        }
      `}>
        <WorkbenchRegionHeading text={props.label} />
        <div
          data-storybook-part="scenario-items"
          style={css`
            & {
              display: flex;
              flex-direction: row;
              min-width: 0;
              flex-grow: 1;
              gap: 2px;
            }
          `}
        >
          {props.items.map(item => <ScenarioButton
            key={item.id}
            item={item}
            selected={item.id === props.activeId}
            onScenario={props.onScenario}
          />)}
        </div>
      </div>
    </div>
  </section>
}
