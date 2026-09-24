import {useState} from "@zavx0z/component"
import type {Document as SemanticDocument} from "@zavx0z/dom"
import {Tree, type TreeItem} from "@zavx0z/ui/widgets/tree"
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
  navigationExpansion?: NavigationExpansion | undefined
}>

/** Передаёт навигацию Storybook общему UI Tree без передачи ему смысла маршрутов. */
export function WorkbenchNavigationTree(props: WorkbenchNavigationTreeProps) {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(props.navigationExpansion?.initialCollapsedIds ?? []),
  )
  const projection = projectWorkbenchNavigation(props.items, props.query, new Set())
  const groups = new Map<string, WorkbenchNavigationGroup>()
  const items = treeItems(projection.topLevel, props, groups)
  const complete = treeItems(projectWorkbenchNavigation(props.items, "", new Set()).topLevel, props, new Map())
  const expandedKeys = [...groups].filter(([, group]) => !collapsedIds.has(group.id)).map(([treeId]) => treeId)
  const selectable = new Map(props.items.map(item => [item.id, item]))

  const onExpandedChange = (keys: readonly string[], event: Event): void => {
    const next = new Set(collapsedIds)
    for (const [treeId, group] of groups) {
      if (keys.includes(treeId)) next.delete(group.id)
      else next.add(group.id)
    }
    const changed = [...groups.values()].find(group => collapsedIds.has(group.id) !== next.has(group.id))
    setCollapsedIds(next)
    props.navigationExpansion?.save([...next])
    if (changed !== undefined) props.onGroupToggle(changed, next.has(changed.id), event.currentTarget as HTMLElement)
  }
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
    onSelectionChange={(keys, event) => { if (keys[0] !== undefined) navigate(keys[0], event) }}
    onActivate={navigate}
  />
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
    label: `Удалить ${item.label} из каталога`,
    iconSrc: closeIcon,
    onAction: (event: Event) => props.onRemove?.(item, event.currentTarget as HTMLElement),
  }] : []
}
