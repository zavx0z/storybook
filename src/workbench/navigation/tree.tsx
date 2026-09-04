import type {Document as SemanticDocument} from "@zavx0z/dom"
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "@zavx0z/component"
import {
  projectWorkbenchNavigation,
  workbenchNavigationGroupKey,
  workbenchNavigationLeafKey,
  workbenchNavigationRowEnabled,
  workbenchNavigationRowKey,
  type WorkbenchNavigationGroup,
  type WorkbenchNavigationItem,
  type WorkbenchNavigationRow,
} from "./model.ts"
import {NavigationRootBlock} from "./row.tsx"
import {
  clamp,
  materializedLeafCount,
  NAVIGATION_FOCUS_VIEW_ROWS,
  NAVIGATION_ROW_HEIGHT,
  NAVIGATION_WINDOW_OVERSCAN,
  NAVIGATION_WINDOW_SIZE,
  retainedBlocks,
  windowedBlocks,
} from "./windowing.ts"

export type WorkbenchNavigationTreeProps = Readonly<{
  document: SemanticDocument
  items: readonly WorkbenchNavigationItem[]
  activeId: string | null
  query: string
  onNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
  onGroupToggle(group: WorkbenchNavigationGroup, collapsed: boolean, source: HTMLElement): void
}>

/** Compiled grouped tree with retained keys and bounded row projection. */
export function WorkbenchNavigationTree(props: WorkbenchNavigationTreeProps) {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(new Set())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [windowStart, setWindowStart] = useState(0)
  const treeRef = useRef<HTMLDivElement | null>(null)
  const pendingFocusRef = useRef<string | null>(null)
  const previousQueryRef = useRef(props.query)
  const programmaticScrollTopRef = useRef<number | null>(null)
  const createdLeafIdsRef = useRef<Set<string>>(new Set())
  const createdGroupIdsRef = useRef<Set<string>>(new Set())
  const bindTree = useCallback((element: HTMLDivElement | null) => {
    treeRef.current = element
  }, [])

  const projection = projectWorkbenchNavigation(props.items, props.query, collapsedGroupIds)
  const enabledRows = projection.rows.filter(workbenchNavigationRowEnabled)
  const activeKey = props.activeId === null ? null : workbenchNavigationLeafKey(props.activeId)
  const effectiveFocusKey = focusKey !== null && enabledRows.some(row =>
    workbenchNavigationRowKey(row) === focusKey)
    ? focusKey
    : enabledRows.some(row => workbenchNavigationRowKey(row) === activeKey)
      ? activeKey
      : workbenchNavigationRowKey(enabledRows[0])
  const clampedWindowStart = clamp(
    windowStart,
    0,
    Math.max(0, projection.rows.length - NAVIGATION_WINDOW_SIZE),
  )
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
    const index = projection.rows.findIndex(row => workbenchNavigationRowKey(row) === key)
    if (index < 0) return
    const tree = treeRef.current
    const firstVisible = Math.floor((tree?.scrollTop ?? 0) / NAVIGATION_ROW_HEIGHT)
    const visible = index >= firstVisible && index < firstVisible + NAVIGATION_FOCUS_VIEW_ROWS
    const materialized = index >= clampedWindowStart &&
      index < clampedWindowStart + NAVIGATION_WINDOW_SIZE
    if (visible && materialized) return
    const scrollRow = clamp(
      index - Math.floor(NAVIGATION_FOCUS_VIEW_ROWS / 2),
      0,
      Math.max(0, projection.rows.length - NAVIGATION_FOCUS_VIEW_ROWS),
    )
    const nextWindowStart = clamp(
      scrollRow - NAVIGATION_WINDOW_OVERSCAN,
      0,
      Math.max(0, projection.rows.length - NAVIGATION_WINDOW_SIZE),
    )
    setWindowStart(nextWindowStart)
    if (tree !== null) {
      const scrollTop = scrollRow * NAVIGATION_ROW_HEIGHT
      programmaticScrollTopRef.current = scrollTop
      tree.scrollTop = scrollTop
    }
  }
  const focusRow = (row: WorkbenchNavigationRow): void => {
    const key = workbenchNavigationRowKey(row)
    if (key === null) return
    ensureRowWindow(key)
    focusRendered(key)
  }
  const toggleGroup = (
    group: WorkbenchNavigationGroup,
    collapsed: boolean,
    source: HTMLElement,
  ): void => {
    setCollapsedGroupIds(current => {
      const next = new Set(current)
      if (collapsed) next.add(group.id)
      else next.delete(group.id)
      return next
    })
    const groupKey = workbenchNavigationGroupKey(group.id)
    if (collapsed && focusKey?.startsWith("leaf:") === true) {
      const focusedItem = props.items.find(item =>
        workbenchNavigationLeafKey(item.id) === focusKey)
      if (focusedItem?.group?.id === group.id) focusRendered(groupKey)
    }
    props.onGroupToggle(group, collapsed, source)
  }
  const activateLeaf = (item: WorkbenchNavigationItem, source: HTMLElement): void => {
    if (item.disabled) return
    const key = workbenchNavigationLeafKey(item.id)
    ensureRowWindow(key)
    focusRendered(key)
    props.onNavigate(item, source)
  }
  const onGroupClick = (group: WorkbenchNavigationGroup, source: HTMLElement): void => {
    toggleGroup(group, !collapsedGroupIds.has(group.id), source)
  }
  const onKeyDown = (keyboard: KeyboardEvent): void => {
    if (!isTreeKey(keyboard.key) || enabledRows.length === 0) return
    const currentKey = rowKeyForTarget(keyboard.target) ?? effectiveFocusKey
    const currentIndex = enabledRows.findIndex(row => workbenchNavigationRowKey(row) === currentKey)
    if (keyboard.key === "ArrowDown" || keyboard.key === "ArrowUp" ||
      keyboard.key === "Home" || keyboard.key === "End") {
      keyboard.preventDefault()
      let next: WorkbenchNavigationRow
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
    const current = projection.rows.find(row => workbenchNavigationRowKey(row) === currentKey)
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
        row.kind === "leaf" && row.parentId === current.id && workbenchNavigationRowEnabled(row))
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
  const onFocusIn = (event: FocusEvent): void => {
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
      const control = row.querySelector<HTMLButtonElement>("button")
      if (control !== null) {
        control.tabIndex = key === effectiveFocusKey && !row.hasAttribute("hidden") ? 0 : -1
      }
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
    if (tree === null) return
    const treeIdentity: object = tree
    if (!batch.records.some(record =>
      record.type === "scroll" && record.target === treeIdentity)) return
    if (programmaticScrollTopRef.current !== null &&
      tree.scrollTop === programmaticScrollTopRef.current) {
      programmaticScrollTopRef.current = null
      return
    }
    programmaticScrollTopRef.current = null
    setWindowStart(clamp(
      Math.floor(tree.scrollTop / NAVIGATION_ROW_HEIGHT) - NAVIGATION_WINDOW_OVERSCAN,
      0,
      Math.max(0, projection.rows.length - NAVIGATION_WINDOW_SIZE),
    ))
  }), [props.document, projection.rows.length])

  function rowElement(key: string | null): HTMLElement | null {
    if (key === null) return null
    const tree = treeRef.current
    if (tree === null) return null
    return [...tree.querySelectorAll<HTMLElement>("[data-tree-row-key]")]
      .find(candidate => candidate.getAttribute("data-tree-row-key") === key) ?? null
  }

  function rowControl(key: string | null): HTMLElement | null {
    return rowElement(key)?.querySelector<HTMLButtonElement>("button") ?? null
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
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex-grow: 1;
      gap: 0;
      overflow-y: auto;
      background: var(--widget-text-background);
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

function rowKeyForTarget(target: EventTarget | null): string | null {
  if (!hasClosest(target)) return null
  const row = target.closest("[data-tree-row-key]")
  return row?.getAttribute("data-tree-row-key") ?? null
}

function hasClosest(target: EventTarget | null): target is EventTarget & Pick<Element, "closest"> {
  return target !== null && "closest" in target
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
