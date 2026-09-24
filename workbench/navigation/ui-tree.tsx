import {useLayoutEffect, useRef, useState} from "@zavx0z/component"
import type {Document as SemanticDocument} from "@zavx0z/dom"
import {Tree, type TreeHandle, type TreeItem} from "@zavx0z/ui/widgets/tree"
import {closeIcon} from "@zavx0z/ui/themes/icons"
import {
  projectWorkbenchNavigation,
  type WorkbenchNavigationGroup,
  type WorkbenchNavigationItem,
  type WorkbenchNavigationTopLevelProjection,
} from "./model.ts"
import type {NavigationExpansion} from "./persistence.ts"

export type WorkbenchNavigationTreeProps = Readonly<{
  document: SemanticDocument
  items: readonly WorkbenchNavigationItem[]
  activeId: string | null
  query: string
  removableIds?: readonly string[]
  onRemove?: ((item: WorkbenchNavigationItem, source: HTMLElement) => void) | undefined
  onNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
  onGroupToggle(group: WorkbenchNavigationGroup, collapsed: boolean, source: HTMLElement): void
  onSearch(value: string, source: HTMLElement): void
  onReady?: ((handle: WorkbenchNavigationTreeHandle | null) => void) | undefined
  navigationExpansion?: NavigationExpansion | undefined
}>

/** Действия панели над полным деревом, которые остаются в домене Storybook. */
export type WorkbenchNavigationTreeHandle = Readonly<{
  revealActive(source: HTMLElement): void
  expandAll(): void
  collapseAll(): void
}>

/** Передаёт навигацию Storybook общему UI Tree без передачи ему смысла маршрутов. */
export function WorkbenchNavigationTree(props: WorkbenchNavigationTreeProps) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(props.navigationExpansion?.initialCollapsedIds ?? []),
  )
  const projection = projectWorkbenchNavigation(props.items, props.query, new Set())
  const groups = new Map<string, WorkbenchNavigationGroup>()
  const items = treeItems(projection.topLevel, props, groups)
  const completeGroups = new Map<string, WorkbenchNavigationGroup>()
  const complete = treeItems(projectWorkbenchNavigation(props.items, "", new Set()).topLevel, props, completeGroups)
  const expandedKeys = [...groups].filter(([, group]) => !collapsedIds.has(group.id)).map(([treeId]) => treeId)
  const selectable = new Map(props.items.map(item => [item.id, item]))
  const treeHandle = useRef<TreeHandle | null>(null)
  const pendingReveal = useRef(false)

  const saveCollapsed = (next: ReadonlySet<string>): void => {
    setCollapsedIds(next)
    props.navigationExpansion?.save([...next])
  }

  const onExpandedChange = (keys: readonly string[], event: Event): void => {
    const changed = [...groups].find(([treeId, group]) => keys.includes(treeId) === collapsedIds.has(group.id))
    if (changed === undefined) return
    const [treeId, group] = changed
    const collapsing = !keys.includes(treeId)
    const next = new Set(collapsedIds)
    if (collapsing) {
      next.add(group.id)
      const branch = findTreeItem(complete, treeId)
      if (branch !== undefined) for (const child of branch.children ?? []) {
        collectCollapsedGroups(child, completeGroups, next)
      }
    } else {
      next.delete(group.id)
    }
    saveCollapsed(next)
    props.onGroupToggle(group, collapsing, event.currentTarget as HTMLElement)
  }
  const revealActive = (source: HTMLElement): void => {
    if (props.activeId === null || !selectable.has(props.activeId)) return
    pendingReveal.current = true
    if (props.query !== "") props.onSearch("", source)
    else showActive()
  }
  const showActive = (): void => {
    if (!pendingReveal.current || props.query !== "" || props.activeId === null) return
    const path = findTreePath(complete, props.activeId)
    if (path === null) {
      pendingReveal.current = false
      return
    }
    const next = new Set(collapsedIds)
    for (const id of path.slice(0, -1)) {
      const group = completeGroups.get(id)
      if (group !== undefined) next.delete(group.id)
    }
    if (next.size !== collapsedIds.size) {
      saveCollapsed(next)
      return
    }
    if (treeHandle.current?.reveal(props.activeId)) pendingReveal.current = false
  }
  useLayoutEffect(() => { showActive() })
  useLayoutEffect(() => {
    props.onReady?.({
      revealActive,
      expandAll: () => saveCollapsed(new Set()),
      collapseAll: () => {
        const next = new Set(collapsedIds)
        for (const group of completeGroups.values()) next.add(group.id)
        saveCollapsed(next)
      },
    })
    return () => props.onReady?.(null)
  })
  const navigate = (id: string, event: Event): void => {
    const item = selectable.get(id)
    if (item !== undefined && !item.disabled) props.onNavigate(item, event.currentTarget as HTMLElement)
  }

  return <Tree
    title="Catalog"
    items={items}
    expandedKeys={expandedKeys}
    selectedKeys={props.activeId === null ? [] : [props.activeId]}
    selectionFollowsFocus={false}
    embedded={true}
    windowing={{size: 80, rowHeight: 24, overscan: 12, viewRows: 20, resetKey: props.query, retainedItems: complete}}
    onExpandedChange={onExpandedChange}
    onReady={handle => {
      treeHandle.current = handle
      if (handle !== null) showActive()
    }}
    onSelectionChange={(keys, event) => { if (keys[0] !== undefined) navigate(keys[0], event) }}
    onActivate={navigate}
  />
}

/** Находит узел в полной иерархии, включая скрытые поиском и свёрнутые ветви. */
function findTreeItem(items: readonly TreeItem[], id: string): TreeItem | undefined {
  for (const item of items) {
    if (item.id === id) return item
    const found = findTreeItem(item.children ?? [], id)
    if (found !== undefined) return found
  }
  return undefined
}

/** Возвращает цепочку ключей от корня до текущей строки для раскрытия предков. */
function findTreePath(items: readonly TreeItem[], id: string): readonly string[] | null {
  for (const item of items) {
    if (item.id === id) return [id]
    const childPath = findTreePath(item.children ?? [], id)
    if (childPath !== null) return [item.id, ...childPath]
  }
  return null
}

/** Запоминает закрытие всех ветвей под свёрнутым родителем одним изменением. */
function collectCollapsedGroups(item: TreeItem, groups: ReadonlyMap<string, WorkbenchNavigationGroup>, result: Set<string>): void {
  const group = groups.get(item.id)
  if (group !== undefined) result.add(group.id)
  for (const child of item.children ?? []) collectCollapsedGroups(child, groups, result)
}

/** Различает выбираемые ветви пакетов и группы только для раскрытия. */
function treeItems(
  entries: readonly WorkbenchNavigationTopLevelProjection[],
  props: WorkbenchNavigationTreeProps,
  groups: Map<string, WorkbenchNavigationGroup>,
): readonly TreeItem[] {
  return entries.map(entry => {
    if (entry.kind === "leaf") {
      if (entry.item.expandable === true) groups.set(entry.item.id, {id: entry.item.id, label: entry.item.label, item: entry.item})
      return leafItem(entry.item, props)
    }
    const group = entry.group
    const item = group.item
    const treeId = item?.id ?? `group:${group.id}`
    groups.set(treeId, group)
    const children = treeItems(entry.children, props, groups)
    return {
      id: treeId,
      label: group.label,
      title: item?.title ?? group.label,
      selectable: item !== undefined,
      current: item?.id === props.activeId,
      expandable: true,
      children,
      ...(item === undefined ? {} : {actions: removeActions(item, props)}),
    }
  })
}

/** Переносит только видимые данные маршрута в предметно нейтральную строку UI. */
function leafItem(item: WorkbenchNavigationItem, props: WorkbenchNavigationTreeProps): TreeItem {
  return {
    id: item.id,
    label: item.label,
    title: item.title ?? item.label,
    disabled: item.disabled,
    expandable: item.expandable,
    current: item.id === props.activeId,
    actions: removeActions(item, props),
  }
}

/** Оставляет удаление корня действием Storybook при общей отрисовке строки. */
function removeActions(item: WorkbenchNavigationItem, props: WorkbenchNavigationTreeProps) {
  return props.removableIds?.includes(item.id) && props.onRemove !== undefined ? [{
    id: "remove",
    label: `Удалить ${item.title ?? item.label} из каталога`,
    iconSrc: closeIcon,
    onAction: (event: Event) => props.onRemove?.(item, event.currentTarget as HTMLElement),
  }] : []
}
