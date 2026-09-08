import {Button, type ButtonProps} from "@zavx0z/ui/buttons/button"
import {chevronDownIcon, chevronRightIcon, closeIcon} from "@zavx0z/ui/themes/icons"
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
  collapsedIds: ReadonlySet<string>
  focusedKey: string | null
  onLeaf(item: WorkbenchNavigationItem, source: HTMLElement): void
  removableIds?: readonly string[]
  onRemove?: ((item: WorkbenchNavigationItem, source: HTMLElement) => void) | undefined
  onGroup(group: WorkbenchNavigationGroup, source: HTMLElement): void
}>

type NavigationLeafButtonProps = Readonly<{
  item: WorkbenchNavigationItem
  active: boolean
  nested: boolean
  depth?: number
  branch?: boolean
  collapsed?: boolean
  onToggle?(source: HTMLElement): void
  onLeaf(item: WorkbenchNavigationItem, source: HTMLElement): void
  removableIds?: readonly string[]
  onRemove?: ((item: WorkbenchNavigationItem, source: HTMLElement) => void) | undefined
}>

/** Root-level group, leaf and spacer row owner. */
export function NavigationRootBlock(props: NavigationRootBlockProps) {
  const block = props.block
  const group = block.kind === "group" ? block.projection.group : null
  const leaf = block.kind === "leaf" ? block.leaf : block.kind === "group" && group?.item !== undefined
    ? {item: group.item, depth: block.projection.depth} : null
  const children = block.kind === "group"
    ? block.children
    : Object.freeze([]) as readonly GroupBlock[]
  const rowKey = group === null
    ? leaf === null ? null : workbenchNavigationLeafKey(leaf.item.id)
    : workbenchNavigationGroupKey(group.id)
  const active = leaf !== null && leaf.item.id === props.activeId
  const disabled = leaf?.item.disabled === true
  const blockRows = navigationRootBlockRows(block, props.collapsed)
  const onGroup: NonNullable<ButtonProps["onClick"]> = event => {
    if (group !== null) props.onGroup(group, event.currentTarget)
  }
  return <div
    role={block.kind === "spacer" || block.hidden ? "presentation" : "treeitem"}
    aria-level={block.kind === "spacer" || block.hidden ? undefined : String(block.kind === "group" ? block.projection.depth : block.leaf.depth)}
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
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: ${blockRows * NAVIGATION_ROW_HEIGHT}px;
      min-height: ${blockRows * NAVIGATION_ROW_HEIGHT}px;
      overflow: clip;

      &[data-kind="group"] {
        background: var(--widget-toolbar-background);
      }

      &[hidden] {
        display: none;
      }
    `}
  >
    {group !== null && leaf === null ? <Button
      label={group.label}
      startIcon={props.collapsed ? chevronRightIcon : chevronDownIcon}
      title={group.label}
      aria-label={group.label}
      aria-expanded={String(!props.collapsed)}
      variant="text"
      style={css`
        width: 100%;
        min-width: 0;
        justify-content: flex-start;
      `}
      onClick={onGroup}
    /> : null}
    {leaf !== null ? <NavigationLeafButton
      item={leaf.item}
      active={active}
      nested={false}
      depth={leaf.depth}
      branch={group !== null}
      collapsed={props.collapsed}
      onToggle={source => { if (group !== null) props.onGroup(group, source) }}
      onLeaf={props.onLeaf}
      removableIds={props.removableIds ?? []}
      onRemove={props.onRemove}
    /> : null}
    <div
      role={group === null ? undefined : "group"}
      aria-label={group?.label}
      data-group-id={group?.id}
      hidden={group === null || props.collapsed}
      style={css`
        display: flex;
        flex-direction: column;
        width: 100%;
        background: var(--widget-text-background);

        &[hidden] {
          display: none;
        }
      `}
    >
      {children.map(child => <NavigationRootBlock
        key={child.key}
        block={child}
        activeId={props.activeId}
        collapsed={child.kind === "group" && props.collapsedIds.has(child.projection.group.id)}
        collapsedIds={props.collapsedIds}
        onGroup={props.onGroup}
        focusedKey={props.focusedKey}
        onLeaf={props.onLeaf}
        removableIds={props.removableIds ?? []}
        onRemove={props.onRemove}
      />)}
    </div>
  </div>
}

/** One production Button owner for both root and nested navigation leaves. */
function NavigationLeafButton(props: NavigationLeafButtonProps) {
  const onClick: NonNullable<ButtonProps["onClick"]> = event => {
    if (!props.item.disabled) props.onLeaf(props.item, event.currentTarget)
  }
  const removable = props.removableIds?.includes(props.item.id) === true
  return <div style={css`
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-direction: row;
    width: 100%;
    min-width: 0;
    padding-left: ${Math.max(0, (props.depth ?? 1) - 1) * 16}px;

    --project-remove-opacity: 0;
    --project-remove-events: none;

    &:hover {
      --project-remove-opacity: 1;
      --project-remove-events: auto;
    }
  `}>
    {props.branch ? <Button
      label=""
      aria-label={`${props.collapsed ? "Развернуть" : "Свернуть"} ${props.item.label}`}
      startIcon={props.collapsed ? chevronRightIcon : chevronDownIcon}
      variant="text"
      tabIndex={-1}
      onClick={event => {
        event.stopPropagation()
        props.onToggle?.(event.currentTarget)
      }}
    /> : null}
    <Button
      label={props.item.label}
      title={props.item.title ?? props.item.label}
      aria-label={props.item.label}
      disabled={props.item.disabled === true}
      selected={props.active}
      variant="text"
      style={css`
        flex: 1;
        min-width: 0;
        justify-content: flex-start;

        ${removable && css`
          padding-right: var(--control-height-medium);
        `}

        ${props.nested && css`
          padding-left: 24px;
        `}
      `}
      onClick={onClick}
    />
    <span
      hidden={!removable}
      data-storybook-remove=""
      style={css`
        position: absolute;
        top: 0;
        right: 0;
        display: flex;
        opacity: var(--project-remove-opacity);
        pointer-events: var(--project-remove-events);

        &[hidden] {
          display: none;
        }
      `}
    >
      <Button
        label=""
        startIcon={closeIcon}
        title={`Удалить ${props.item.label} из каталога`}
        aria-label={`Удалить ${props.item.label} из каталога`}
        variant="text"
        onClick={event => {
          event.stopPropagation()
          props.onRemove?.(props.item, event.currentTarget)
        }}
      />
    </span>
  </div>
}
