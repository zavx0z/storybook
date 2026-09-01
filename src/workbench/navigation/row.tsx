import {Button} from "@ui/components/button"
import {chevronDownIcon, chevronRightIcon} from "@ui/components/icons"
import type {Event, HTMLElement} from "@zavx0z/dom"
import {
  workbenchNavigationGroupKey,
  workbenchNavigationLeafKey,
  type WorkbenchNavigationGroup,
  type WorkbenchNavigationItem,
} from "./model.ts"
import {
  NAVIGATION_ROW_HEIGHT,
  navigationRootBlockRows,
  type GroupBlock,
  type RootBlock,
} from "./windowing.ts"

export type NavigationRootBlockProps = Readonly<{
  block: RootBlock
  activeId: string | null
  collapsed: boolean
  focusedKey: string | null
  onLeaf(item: WorkbenchNavigationItem, source: HTMLElement): void
  onGroup(group: WorkbenchNavigationGroup, source: HTMLElement): void
}>

type NavigationGroupBlockProps = Readonly<{
  block: GroupBlock
  activeId: string | null
  focusedKey: string | null
  onLeaf(item: WorkbenchNavigationItem, source: HTMLElement): void
}>

type NavigationLeafButtonProps = Readonly<{
  item: WorkbenchNavigationItem
  active: boolean
  nested: boolean
  onLeaf(item: WorkbenchNavigationItem, source: HTMLElement): void
}>

/** Root-level group, leaf and spacer row owner. */
export function NavigationRootBlock(props: NavigationRootBlockProps) {
  const block = props.block
  const group = block.kind === "group" ? block.projection.group : null
  const leaf = block.kind === "leaf" ? block.leaf : null
  const children = block.kind === "group"
    ? block.children
    : Object.freeze([]) as readonly GroupBlock[]
  const rowKey = group === null
    ? leaf === null ? null : workbenchNavigationLeafKey(leaf.item.id)
    : workbenchNavigationGroupKey(group.id)
  const active = leaf !== null && leaf.item.id === props.activeId
  const disabled = leaf?.item.disabled === true
  const blockRows = navigationRootBlockRows(block, props.collapsed)
  const onGroup = (event: Event) => {
    if (group !== null) props.onGroup(group, event.currentTarget as HTMLElement)
  }
  return <div
    role={block.kind === "spacer" || block.hidden ? "presentation" : "treeitem"}
    aria-level={block.kind === "spacer" || block.hidden ? undefined : "1"}
    aria-label={group?.label ?? leaf?.item.label}
    aria-expanded={group === null ? undefined : String(!props.collapsed)}
    aria-current={active ? "page" : undefined}
    aria-disabled={leaf === null ? undefined : String(disabled)}
    data-tree-row-key={rowKey}
    data-group-id={group?.id}
    data-id={leaf?.item.id}
    data-kind={block.kind}
    data-focused={rowKey !== null && rowKey === props.focusedKey ? "true" : undefined}
    hidden={block.hidden}
    style={css`
      & {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: ${blockRows * NAVIGATION_ROW_HEIGHT}px;
        min-height: ${blockRows * NAVIGATION_ROW_HEIGHT}px;
        overflow: clip;
      }
      &[data-kind="group"] { background: var(--widget-toolbar-background); }
      &[hidden] { display: none; }
    `}
  >
    {group !== null ? <Button
      label={group.label}
      startIcon={props.collapsed ? chevronRightIcon : chevronDownIcon}
      title={group.label}
      aria-label={group.label}
      aria-expanded={String(!props.collapsed)}
      variant="text"
      style={css`
        & {
          width: 100%;
          min-width: 0;
          justify-content: flex-start;
        }
      `}
      onClick={onGroup}
    /> : null}
    {leaf !== null ? <NavigationLeafButton
      item={leaf.item}
      active={active}
      nested={false}
      onLeaf={props.onLeaf}
    /> : null}
    <div
      role={group === null ? undefined : "group"}
      aria-label={group?.label}
      data-group-id={group?.id}
      hidden={group === null || props.collapsed}
      style={css`
        & {
          display: flex;
          flex-direction: column;
          width: 100%;
          background: var(--widget-text-background);
        }
        &[hidden] { display: none; }
      `}
    >
      {children.map(child => <NavigationGroupBlock
        key={child.key}
        block={child}
        activeId={props.activeId}
        focusedKey={props.focusedKey}
        onLeaf={props.onLeaf}
      />)}
    </div>
  </div>
}

/** Nested leaf and spacer row owner. */
function NavigationGroupBlock(props: NavigationGroupBlockProps) {
  const block = props.block
  const leaf = block.kind === "leaf" ? block.leaf : null
  const rowKey = leaf === null ? null : workbenchNavigationLeafKey(leaf.item.id)
  const active = leaf !== null && leaf.item.id === props.activeId
  const disabled = leaf?.item.disabled === true
  return <div
    role={block.kind === "spacer" || block.hidden ? "presentation" : "treeitem"}
    aria-level={block.kind === "spacer" || block.hidden ? undefined : "2"}
    aria-label={leaf?.item.label}
    aria-current={active ? "page" : undefined}
    aria-disabled={leaf === null ? undefined : String(disabled)}
    data-tree-row-key={rowKey}
    data-id={leaf?.item.id}
    data-kind={block.kind}
    data-focused={rowKey !== null && rowKey === props.focusedKey ? "true" : undefined}
    hidden={block.hidden}
    style={css`
      & {
        box-sizing: border-box;
        display: flex;
        width: 100%;
        height: ${block.kind === "spacer" ? block.rows * NAVIGATION_ROW_HEIGHT : NAVIGATION_ROW_HEIGHT}px;
        min-height: ${block.kind === "spacer" ? block.rows * NAVIGATION_ROW_HEIGHT : NAVIGATION_ROW_HEIGHT}px;
        overflow: clip;
      }
      &[hidden] { display: none; }
    `}
  >
    {leaf !== null ? <NavigationLeafButton
      item={leaf.item}
      active={active}
      nested={true}
      onLeaf={props.onLeaf}
    /> : null}
  </div>
}

/** One production Button owner for both root and nested navigation leaves. */
function NavigationLeafButton(props: NavigationLeafButtonProps) {
  const onClick = (event: Event) => {
    if (!props.item.disabled) props.onLeaf(props.item, event.currentTarget as HTMLElement)
  }
  return <Button
    label={props.item.label}
    title={props.item.title ?? props.item.label}
    aria-label={props.item.label}
    disabled={props.item.disabled === true}
    selected={props.active}
    variant="text"
    style={css`
      & {
        width: 100%;
        min-width: 0;
        justify-content: flex-start;
      }
      ${props.nested && css`
        & { padding-left: 24px; }
      `}
    `}
    onClick={onClick}
  />
}
