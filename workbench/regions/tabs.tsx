import {Button, type ButtonProps} from "@zavx0z/ui/buttons/button"
import type {WorkbenchTabItem} from "../contract.ts"

type TabProps = Readonly<{
  item: WorkbenchTabItem
  selected: boolean
  onTab(item: WorkbenchTabItem, source: HTMLElement): void
}>

export type TabsRegionProps = Readonly<{
  label: string
  items: readonly WorkbenchTabItem[]
  activeId: string | null
  onTab(item: WorkbenchTabItem, source: HTMLElement): void
}>

function Tab(props: TabProps) {
  const onClick: NonNullable<ButtonProps["onClick"]> = event => {
    if (!props.item.disabled) props.onTab(props.item, event.currentTarget)
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

/** Панель адресуемых вкладок выбранного предмета. */
export function TabsRegion(props: TabsRegionProps) {
  return <section
    role="toolbar"
    data-storybook-region="tabs"
    aria-label={props.label}
    style={css`
      display: flex;
      width: 100%;
      flex-shrink: 0;
    `}
  >
    <div
      data-storybook-part="tab-items"
      style={css`
        box-sizing: border-box;
        display: flex;
        flex-direction: row;
        width: 100%;
        min-width: 0;
        gap: 2px;
        padding: 2px 0 0;
        overflow: clip;
      `}
    >
      {props.items.map(item => <Tab
        key={item.id}
        item={item}
        selected={item.id === props.activeId}
        onTab={props.onTab}
      />)}
    </div>
  </section>
}
