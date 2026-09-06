import {Button, type ButtonProps} from "@zavx0z/ui/buttons/button"
import type {WorkbenchNavigationItem} from "../contract.ts"

type WorkbenchNavigationListItemProps = Readonly<{
  item: WorkbenchNavigationItem
  selected: boolean
  onNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
}>

export type WorkbenchNavigationListProps = Readonly<{
  items: readonly WorkbenchNavigationItem[]
  activeId: string | null
  onNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
}>

function WorkbenchNavigationListItem(props: WorkbenchNavigationListItemProps) {
  const onClick: NonNullable<ButtonProps["onClick"]> = event => {
    if (!props.item.disabled) props.onNavigate(props.item, event.currentTarget)
  }
  return <div
    role="listitem"
    aria-current={props.selected ? "page" : undefined}
    aria-disabled={String(props.item.disabled === true)}
    data-id={props.item.id}
    data-route={props.item.route}
    style={css`
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 24px;
    `}
  >
    <Button
      label={props.item.label}
      title={props.item.title ?? props.item.label}
      aria-label={props.item.label}
      disabled={props.item.disabled === true}
      selected={props.selected}
      style={css`
        width: 100%;
        min-width: 0;
        justify-content: flex-start;
      `}
      onClick={onClick}
    />
  </div>
}

export function WorkbenchNavigationList(props: WorkbenchNavigationListProps) {
  return <div
    role="list"
    style={css`
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex-grow: 1;
      gap: 1px;
      overflow-y: auto;
    `}
  >
    {props.items.map(item => <WorkbenchNavigationListItem
      key={item.id}
      item={item}
      selected={item.id === props.activeId}
      onNavigate={props.onNavigate}
    />)}
  </div>
}
