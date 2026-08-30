import {Button} from "@ui/components/button"
import type {
  Document,
  Element,
  Event,
  HTMLElement,
  KeyboardEvent,
} from "@zavx0z/dom"
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "@zavx0z/react"
import {
  projectStorybookDomNavigation,
  storybookDomNavigationGroupKey,
  storybookDomNavigationLeafKey,
  storybookDomNavigationRowEnabled,
  storybookDomNavigationRowKey,
  type StorybookDomNavigationGroup,
  type StorybookDomNavigationGroupProjection,
  type StorybookDomNavigationItem,
  type StorybookDomNavigationLeafProjection,
  type StorybookDomNavigationProjection,
  type StorybookDomNavigationRow,
} from "./navigation-tree.ts"

export type StorybookNavigationTreeProps = Readonly<{
  document: Document
  items: readonly StorybookDomNavigationItem[]
  activeId: string | null
  query: string
  onNavigate(item: StorybookDomNavigationItem, source: HTMLElement): void
  onGroupToggle(group: StorybookDomNavigationGroup, collapsed: boolean, source: HTMLElement): void
}>

type RootBlock = Readonly<{
  kind: "group"
  key: string
  projection: StorybookDomNavigationGroupProjection
  children: readonly GroupBlock[]
  hidden: boolean
}> | Readonly<{
  kind: "leaf"
  key: string
  leaf: StorybookDomNavigationLeafProjection
  hidden: boolean
}> | Readonly<{
  kind: "spacer"
  key: string
  rows: number
  hidden: false
}>

type GroupBlock = Readonly<{
  kind: "leaf"
  key: string
  leaf: StorybookDomNavigationLeafProjection
  hidden: boolean
}> | Readonly<{
  kind: "spacer"
  key: string
  rows: number
  hidden: false
}>

type RootBlockProps = Readonly<{
  block: RootBlock
  activeId: string | null
  collapsed: boolean
  focusedKey: string | null
  onLeaf(item: StorybookDomNavigationItem, source: HTMLElement): void
  onGroup(group: StorybookDomNavigationGroup, source: HTMLElement): void
}>

type GroupBlockProps = Readonly<{
  block: GroupBlock
  activeId: string | null
  focusedKey: string | null
  onLeaf(item: StorybookDomNavigationItem, source: HTMLElement): void
}>

const ROW_HEIGHT = 24
const WINDOW_SIZE = 80
const WINDOW_OVERSCAN = 12
const FOCUS_VIEW_ROWS = 20

const rowButtonStyle: CssStyle = css`
  & {
    width: 100%;
    min-width: 0;
    height: 24px;
    padding: 3px 6px;
    border: 0;
    border-radius: 2px;
    justify-content: flex-start;
    background: transparent;
    box-shadow: none;
    font-size: 11px;
  }
`

const nestedRowButtonStyle: CssStyle = css`
  & { padding-left: 24px; }
`

const groupButtonStyle: CssStyle = css`
  & {
    width: 100%;
    min-width: 0;
    height: 24px;
    padding: 0 4px;
    border: 0;
    border-radius: 2px;
    justify-content: flex-start;
    background: transparent;
    box-shadow: none;
    font-size: 11px;
  }
`

function NavigationRootBlock(props: RootBlockProps) {
  const block = props.block
  const group = block.kind === "group" ? block.projection.group : null
  const leaf = block.kind === "leaf" ? block.leaf : null
  const children = block.kind === "group" ? block.children : Object.freeze([]) as readonly GroupBlock[]
  const rowKey = group === null
    ? leaf === null ? null : storybookDomNavigationLeafKey(leaf.item.id)
    : storybookDomNavigationGroupKey(group.id)
  const active = leaf !== null && leaf.item.id === props.activeId
  const disabled = leaf?.item.disabled === true
  const onGroup = (event: Event) => {
    if (group !== null) props.onGroup(group, event.currentTarget as HTMLElement)
  }
  const onLeaf = (event: Event) => {
    if (leaf !== null && !leaf.item.disabled) {
      props.onLeaf(leaf.item, event.currentTarget as HTMLElement)
    }
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
        height: ${block.kind === "spacer" ? block.rows * ROW_HEIGHT : ROW_HEIGHT}px;
        min-height: ${block.kind === "spacer" ? block.rows * ROW_HEIGHT : ROW_HEIGHT}px;
        overflow: clip;
        border: 1px solid transparent;
        border-radius: 2px;
        background: var(--widget-regular-background);
        color: var(--widget-list-content);
      }
      &[data-kind="group"] { background: var(--widget-toolbar-background); }
      &[data-kind="spacer"] {
        border: 0;
        background: transparent;
      }
      &[hidden] { display: none; }
      &[aria-current="page"] {
        border-color: var(--widget-focus-outline);
        background: var(--widget-list-background-selected);
        color: var(--widget-list-content-selected);
      }
      &[data-focused="true"] { border-color: var(--widget-focus-outline); }
      &[aria-disabled="true"] { opacity: 0.5; }
    `}
  >
    {group !== null ? <Button
      label={group === null ? "" : `${props.collapsed ? "▸" : "▾"} ${group.label}`}
      title={group?.label}
      aria-label={group?.label}
      aria-expanded={group === null ? undefined : String(!props.collapsed)}
      style={groupButtonStyle}
      onClick={onGroup}
    /> : null}
    {leaf !== null ? <Button
      label={leaf?.item.label ?? ""}
      title={leaf?.item.title ?? leaf?.item.label}
      aria-label={leaf?.item.label}
      disabled={disabled}
      selected={active}
      style={rowButtonStyle}
      onClick={onLeaf}
    /> : null}
    <div
      role={group === null ? undefined : "group"}
      aria-label={group?.label}
      data-group-id={group?.id}
      hidden={group === null || props.collapsed}
      style={css`
        & { display: flex; flex-direction: column; width: 100%; background: var(--widget-text-background); }
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

function NavigationGroupBlock(props: GroupBlockProps) {
  const block = props.block
  const leaf = block.kind === "leaf" ? block.leaf : null
  const rowKey = leaf === null ? null : storybookDomNavigationLeafKey(leaf.item.id)
  const active = leaf !== null && leaf.item.id === props.activeId
  const disabled = leaf?.item.disabled === true
  const onClick = (event: Event) => {
    if (leaf !== null && !leaf.item.disabled) {
      props.onLeaf(leaf.item, event.currentTarget as HTMLElement)
    }
  }
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
        height: ${block.kind === "spacer" ? block.rows * ROW_HEIGHT : ROW_HEIGHT}px;
        min-height: ${block.kind === "spacer" ? block.rows * ROW_HEIGHT : ROW_HEIGHT}px;
        overflow: clip;
        border: 1px solid transparent;
        background: var(--widget-text-background);
        color: var(--widget-list-content);
      }
      &[data-kind="spacer"] {
        border: 0;
        background: transparent;
      }
      &[hidden] { display: none; }
      &[aria-current="page"] {
        border-color: var(--widget-focus-outline);
        background: var(--widget-list-background-selected);
        color: var(--widget-list-content-selected);
      }
      &[data-focused="true"] { border-color: var(--widget-focus-outline); }
      &[aria-disabled="true"] { opacity: 0.5; }
    `}
  >
    {leaf !== null ? <Button
      label={leaf?.item.label ?? ""}
      title={leaf?.item.title ?? leaf?.item.label}
      aria-label={leaf?.item.label}
      disabled={disabled}
      selected={active}
      style={css`${rowButtonStyle}${nestedRowButtonStyle}`}
      onClick={onClick}
    /> : null}
  </div>
}

/** Compiled grouped tree with retained keys and bounded row projection. */
export function StorybookNavigationTree(props: StorybookNavigationTreeProps) {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(new Set())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [windowStart, setWindowStart] = useState(0)
  const treeRef = useRef<HTMLElement | null>(null)
  const pendingFocusRef = useRef<string | null>(null)
  const previousQueryRef = useRef(props.query)
  const programmaticScrollTopRef = useRef<number | null>(null)
  const createdLeafIdsRef = useRef<Set<string>>(new Set())
  const createdGroupIdsRef = useRef<Set<string>>(new Set())
  const bindTree = useCallback((element: HTMLElement | null) => {
    treeRef.current = element
  }, [])

  const projection = projectStorybookDomNavigation(props.items, props.query, collapsedGroupIds)
  const enabledRows = projection.rows.filter(storybookDomNavigationRowEnabled)
  const activeKey = props.activeId === null ? null : storybookDomNavigationLeafKey(props.activeId)
  const effectiveFocusKey = focusKey !== null && enabledRows.some(row =>
    storybookDomNavigationRowKey(row) === focusKey)
    ? focusKey
    : enabledRows.some(row => storybookDomNavigationRowKey(row) === activeKey)
      ? activeKey
      : storybookDomNavigationRowKey(enabledRows[0])
  const clampedWindowStart = clamp(windowStart, 0, Math.max(0, projection.rows.length - WINDOW_SIZE))
  const visibleBlocks = windowedBlocks(
    projection,
    clampedWindowStart,
    effectiveFocusKey,
    collapsedGroupIds,
  )
  for (const block of visibleBlocks) {
    if (block.kind === "leaf") createdLeafIdsRef.current.add(block.leaf.item.id)
    if (block.kind === "group") {
      createdGroupIdsRef.current.add(block.projection.group.id)
      for (const child of block.children) {
        if (child.kind === "leaf") createdLeafIdsRef.current.add(child.leaf.item.id)
      }
    }
  }
  const blocks = retainedBlocks(
    visibleBlocks,
    props.items,
    createdGroupIdsRef.current,
    createdLeafIdsRef.current,
  )

  const focusRendered = (key: string): void => {
    pendingFocusRef.current = key
    setFocusKey(key)
  }
  const ensureRowWindow = (key: string): void => {
    const index = projection.rows.findIndex(row => storybookDomNavigationRowKey(row) === key)
    if (index < 0) return
    const tree = treeRef.current
    const firstVisible = Math.floor((tree?.scrollTop ?? 0) / ROW_HEIGHT)
    const visible = index >= firstVisible && index < firstVisible + FOCUS_VIEW_ROWS
    const materialized = index >= clampedWindowStart && index < clampedWindowStart + WINDOW_SIZE
    if (visible && materialized) return
    const scrollRow = clamp(
      index - Math.floor(FOCUS_VIEW_ROWS / 2),
      0,
      Math.max(0, projection.rows.length - FOCUS_VIEW_ROWS),
    )
    const nextWindowStart = clamp(
      scrollRow - WINDOW_OVERSCAN,
      0,
      Math.max(0, projection.rows.length - WINDOW_SIZE),
    )
    setWindowStart(nextWindowStart)
    if (tree !== null) {
      const scrollTop = scrollRow * ROW_HEIGHT
      programmaticScrollTopRef.current = scrollTop
      tree.scrollTop = scrollTop
    }
  }
  const focusRow = (row: StorybookDomNavigationRow): void => {
    const key = storybookDomNavigationRowKey(row)
    if (key === null) return
    ensureRowWindow(key)
    focusRendered(key)
  }
  const toggleGroup = (
    group: StorybookDomNavigationGroup,
    collapsed: boolean,
    source: HTMLElement,
  ): void => {
    setCollapsedGroupIds(current => {
      const next = new Set(current)
      if (collapsed) next.add(group.id)
      else next.delete(group.id)
      return next
    })
    const groupKey = storybookDomNavigationGroupKey(group.id)
    if (collapsed && focusKey?.startsWith("leaf:") === true) {
      const focusedItem = props.items.find(item =>
        storybookDomNavigationLeafKey(item.id) === focusKey)
      if (focusedItem?.group?.id === group.id) focusRendered(groupKey)
    }
    props.onGroupToggle(group, collapsed, source)
  }
  const activateLeaf = (item: StorybookDomNavigationItem, source: HTMLElement): void => {
    if (item.disabled) return
    const key = storybookDomNavigationLeafKey(item.id)
    ensureRowWindow(key)
    focusRendered(key)
    props.onNavigate(item, source)
  }
  const onGroupClick = (group: StorybookDomNavigationGroup, source: HTMLElement): void => {
    toggleGroup(group, !collapsedGroupIds.has(group.id), source)
  }
  const onKeyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent
    if (!isTreeKey(keyboard.key) || enabledRows.length === 0) return
    const currentKey = rowKeyForTarget(keyboard.target) ?? effectiveFocusKey
    const currentIndex = enabledRows.findIndex(row => storybookDomNavigationRowKey(row) === currentKey)
    if (keyboard.key === "ArrowDown" || keyboard.key === "ArrowUp" ||
      keyboard.key === "Home" || keyboard.key === "End") {
      keyboard.preventDefault()
      let next: StorybookDomNavigationRow
      if (keyboard.key === "Home") next = enabledRows[0]!
      else if (keyboard.key === "End") next = enabledRows.at(-1)!
      else {
        const direction = keyboard.key === "ArrowDown" ? 1 : -1
        const origin = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex
        next = enabledRows[(origin + direction + enabledRows.length) % enabledRows.length]!
      }
      focusRow(next)
      return
    }
    const current = projection.rows.find(row => storybookDomNavigationRowKey(row) === currentKey)
    if (current === undefined) return
    if (keyboard.key === "ArrowLeft") {
      keyboard.preventDefault()
      if (current.kind === "group" && !collapsedGroupIds.has(current.id)) {
        toggleGroup(current.group.group, true, rowElement(currentKey) ?? treeRef.current!)
      } else if (current.kind === "leaf" && current.parentId !== null) {
        const parent = projection.rows.find(row => row.kind === "group" && row.id === current.parentId)
        if (parent !== undefined) focusRow(parent)
      }
      return
    }
    if (keyboard.key === "ArrowRight") {
      keyboard.preventDefault()
      if (current.kind !== "group") return
      if (collapsedGroupIds.has(current.id)) {
        toggleGroup(current.group.group, false, rowElement(currentKey) ?? treeRef.current!)
        return
      }
      const child = projection.rows.find(row =>
        row.kind === "leaf" && row.parentId === current.id && storybookDomNavigationRowEnabled(row))
      if (child !== undefined) focusRow(child)
      return
    }
    if (!isActivationKey(keyboard.key)) return
    keyboard.preventDefault()
    if (current.kind === "group") {
      toggleGroup(
        current.group.group,
        !collapsedGroupIds.has(current.id),
        rowElement(currentKey) ?? treeRef.current!,
      )
    } else if (!current.item.disabled) {
      activateLeaf(current.item, rowElement(currentKey) ?? treeRef.current!)
    }
  }
  const onFocusIn = (event: Event): void => {
    const key = rowKeyForTarget(event.target)
    if (key !== null) setFocusKey(key)
  }

  useLayoutEffect(() => {
    const groupIds = new Set(props.items.flatMap(item => item.group === undefined ? [] : [item.group.id]))
    setCollapsedGroupIds(current => {
      const next = new Set([...current].filter(id => groupIds.has(id)))
      return equalSets(current, next) ? current : next
    })
  }, [props.items])

  useLayoutEffect(() => {
    if (previousQueryRef.current !== props.query) {
      previousQueryRef.current = props.query
      setWindowStart(0)
      const tree = treeRef.current
      if (tree !== null) {
        programmaticScrollTopRef.current = 0
        tree.scrollTop = 0
      }
    } else if (activeKey !== null) {
      ensureRowWindow(activeKey)
    }
  }, [props.query, props.activeId, props.items])

  useLayoutEffect(() => {
    const tree = treeRef.current
    if (tree === null) return
    for (const row of tree.querySelectorAll("[data-tree-row-key]")) {
      const key = row.getAttribute("data-tree-row-key")
      const control = row.querySelector("button") as HTMLElement | null
      if (control !== null) control.tabIndex = key === effectiveFocusKey && !row.hasAttribute("hidden") ? 0 : -1
    }
  }, [effectiveFocusKey, blocks])

  useLayoutEffect(() => {
    const key = pendingFocusRef.current
    if (key === null) return
    pendingFocusRef.current = null
    rowControl(key)?.focus({focusVisible: true})
  })

  useLayoutEffect(() => props.document.subscribeStateChanges(batch => {
    const tree = treeRef.current
    if (tree === null || !batch.records.some(record => record.type === "scroll" && record.target === tree)) return
    if (programmaticScrollTopRef.current !== null && tree.scrollTop === programmaticScrollTopRef.current) {
      programmaticScrollTopRef.current = null
      return
    }
    programmaticScrollTopRef.current = null
    setWindowStart(clamp(
      Math.floor(tree.scrollTop / ROW_HEIGHT) - WINDOW_OVERSCAN,
      0,
      Math.max(0, projection.rows.length - WINDOW_SIZE),
    ))
  }), [props.document, projection.rows.length])

  function rowElement(key: string | null): HTMLElement | null {
    if (key === null) return null
    const tree = treeRef.current
    if (tree === null) return null
    return [...tree.querySelectorAll("[data-tree-row-key]")]
      .find(candidate => candidate.getAttribute("data-tree-row-key") === key) as HTMLElement | undefined ?? null
  }

  function rowControl(key: string | null): HTMLElement | null {
    return rowElement(key)?.querySelector("button") as HTMLElement | null
  }

  return <div
    ref={bindTree}
    role="tree"
    aria-label="Catalog"
    data-storybook-tree="catalog"
    data-storybook-tree-total={String(projection.leaves.length)}
    data-storybook-tree-total-rows={String(projection.rows.length)}
    data-storybook-tree-materialized={String(materializedLeafCount(blocks))}
    data-storybook-tree-created={String(createdLeafIdsRef.current.size)}
    data-storybook-tree-window-start={String(clampedWindowStart)}
    onKeyDown={onKeyDown}
    onFocusIn={onFocusIn}
    style={css`
      & {
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex-grow: 1;
        gap: 0;
        overflow-y: auto;
        background: var(--widget-text-background);
      }
    `}
  >
    {blocks.map(block => <NavigationRootBlock
      key={block.key}
      block={block}
      activeId={props.activeId}
      collapsed={block.kind === "group" && collapsedGroupIds.has(block.projection.group.id)}
      focusedKey={effectiveFocusKey}
      onLeaf={activateLeaf}
      onGroup={onGroupClick}
    />)}
  </div>
}

function windowedBlocks(
  projection: StorybookDomNavigationProjection,
  windowStart: number,
  focusKey: string | null,
  collapsedGroupIds: ReadonlySet<string>,
): readonly RootBlock[] {
  const windowEnd = Math.min(projection.rows.length, windowStart + WINDOW_SIZE)
  const focusedRow = focusKey === null
    ? -1
    : projection.rows.findIndex(row => storybookDomNavigationRowKey(row) === focusKey)
  const materializes = (index: number): boolean =>
    (index >= windowStart && index < windowEnd) || index === focusedRow
  const output: RootBlock[] = []
  let pendingRootRows = 0
  let rootSpacerStart = 0
  let rowIndex = 0
  const flushRootSpacer = (): void => {
    if (pendingRootRows === 0) return
    output.push(Object.freeze({
      kind: "spacer",
      key: `spacer:${rootSpacerStart}:${pendingRootRows}`,
      rows: pendingRootRows,
      hidden: false,
    }))
    pendingRootRows = 0
  }
  for (const entry of projection.topLevel) {
    if (entry.kind === "leaf") {
      const visible = materializes(rowIndex)
      if (!visible) {
        if (pendingRootRows === 0) rootSpacerStart = rowIndex
        pendingRootRows += 1
      } else {
        flushRootSpacer()
        output.push(Object.freeze({kind: "leaf", key: storybookDomNavigationLeafKey(entry.item.id), leaf: entry, hidden: false}))
      }
      rowIndex += 1
      continue
    }
    const blockStart = rowIndex
    const collapsed = collapsedGroupIds.has(entry.group.id)
    const blockEnd = blockStart + 1 + (collapsed ? 0 : entry.items.length)
    rowIndex = blockEnd
    const intersects = blockEnd > windowStart && blockStart < windowEnd
    const containsFocus = focusedRow >= blockStart && focusedRow < blockEnd
    if (!intersects && !containsFocus) {
      if (pendingRootRows === 0) rootSpacerStart = blockStart
      pendingRootRows += blockEnd - blockStart
      continue
    }
    flushRootSpacer()
    const children: GroupBlock[] = []
    let pendingRows = 0
    let spacerStart = blockStart + 1
    if (!collapsed) {
      for (const [offset, item] of entry.items.entries()) {
        const itemRow = blockStart + 1 + offset
        if (!materializes(itemRow)) {
          if (pendingRows === 0) spacerStart = itemRow
          pendingRows += 1
          continue
        }
        if (pendingRows > 0) {
          children.push(Object.freeze({kind: "spacer", key: `spacer:${spacerStart}:${pendingRows}`, rows: pendingRows, hidden: false}))
          pendingRows = 0
        }
        children.push(Object.freeze({
          kind: "leaf",
          key: storybookDomNavigationLeafKey(item.id),
          leaf: Object.freeze({kind: "leaf", item, parentId: entry.group.id}),
          hidden: false,
        }))
      }
      if (pendingRows > 0) {
        children.push(Object.freeze({kind: "spacer", key: `spacer:${spacerStart}:${pendingRows}`, rows: pendingRows, hidden: false}))
      }
    }
    output.push(Object.freeze({
      kind: "group",
      key: storybookDomNavigationGroupKey(entry.group.id),
      projection: entry,
      children: Object.freeze(children),
      hidden: false,
    }))
  }
  flushRootSpacer()
  return Object.freeze(output)
}

function retainedBlocks(
  visible: readonly RootBlock[],
  items: readonly StorybookDomNavigationItem[],
  createdGroupIds: ReadonlySet<string>,
  createdLeafIds: ReadonlySet<string>,
): readonly RootBlock[] {
  const visibleRootKeys = new Set(visible.map(({key}) => key))
  const output = visible.map(block => {
    if (block.kind !== "group") return block
    const visibleChildKeys = new Set(block.children.map(({key}) => key))
    const retained = items.flatMap(item =>
      item.group?.id === block.projection.group.id && createdLeafIds.has(item.id) &&
        !visibleChildKeys.has(storybookDomNavigationLeafKey(item.id))
        ? [Object.freeze({
            kind: "leaf" as const,
            key: storybookDomNavigationLeafKey(item.id),
            leaf: Object.freeze({kind: "leaf" as const, item, parentId: item.group.id}),
            hidden: true,
          })]
        : [])
    return Object.freeze({...block, children: Object.freeze([...block.children, ...retained])})
  })

  for (const groupId of createdGroupIds) {
    const key = storybookDomNavigationGroupKey(groupId)
    if (visibleRootKeys.has(key)) continue
    const groupedItems = items.filter(item => item.group?.id === groupId)
    const group = groupedItems[0]?.group
    if (group === undefined) continue
    output.push(Object.freeze({
      kind: "group",
      key,
      projection: Object.freeze({kind: "group", group, items: Object.freeze(groupedItems)}),
      children: Object.freeze(groupedItems.flatMap(item => createdLeafIds.has(item.id)
        ? [Object.freeze({
            kind: "leaf" as const,
            key: storybookDomNavigationLeafKey(item.id),
            leaf: Object.freeze({kind: "leaf" as const, item, parentId: groupId}),
            hidden: true,
          })]
        : [])),
      hidden: true,
    }))
  }

  for (const item of items) {
    const key = storybookDomNavigationLeafKey(item.id)
    if (item.group !== undefined || !createdLeafIds.has(item.id) || visibleRootKeys.has(key)) continue
    output.push(Object.freeze({
      kind: "leaf",
      key,
      leaf: Object.freeze({kind: "leaf", item, parentId: null}),
      hidden: true,
    }))
  }
  return Object.freeze(output)
}

function rowKeyForTarget(target: unknown): string | null {
  if (target === null || typeof target !== "object" || !("closest" in target)) return null
  const row = (target as Element).closest("[data-tree-row-key]")
  return row?.getAttribute("data-tree-row-key") ?? null
}

function materializedLeafCount(blocks: readonly RootBlock[]): number {
  return blocks.reduce((count, block) => count + (
    block.kind === "leaf" && !block.hidden
      ? 1
      : block.kind === "group"
        ? block.children.filter(child => child.kind === "leaf" && !child.hidden).length
        : 0
  ), 0)
}

function equalSets(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every(value => right.has(value))
}

function isTreeKey(key: string): boolean {
  return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End" ||
    key === "ArrowLeft" || key === "ArrowRight" || isActivationKey(key)
}

function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Space" || key === "Spacebar"
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
