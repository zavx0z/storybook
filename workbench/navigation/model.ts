/** Pure validation and projection for Workbench navigation. */

export type WorkbenchNavigationGroup = Readonly<{
  id: string
  label: string
  item?: WorkbenchNavigationItem
}>

export type WorkbenchNavigationItem = Readonly<{
  id: string
  label: string
  route: string
  title?: string
  disabled?: boolean
  searchText?: string
  group?: WorkbenchNavigationGroup
  parentId?: string
}>

export type WorkbenchNavigationGroupProjection = Readonly<{
  kind: "group"
  group: WorkbenchNavigationGroup
  items: readonly WorkbenchNavigationItem[]
  children: readonly WorkbenchNavigationTopLevelProjection[]
  parentId: string | null
  depth: number
}>

export type WorkbenchNavigationLeafProjection = Readonly<{
  kind: "leaf"
  item: WorkbenchNavigationItem
  parentId: string | null
  depth: number
}>

export type WorkbenchNavigationTopLevelProjection =
  | WorkbenchNavigationGroupProjection
  | WorkbenchNavigationLeafProjection

export type WorkbenchNavigationRow = Readonly<{
  kind: "group"
  id: string
  group: WorkbenchNavigationGroupProjection
  parentId: string | null
  depth: number
}> | Readonly<{
  kind: "leaf"
  id: string
  item: WorkbenchNavigationItem
  parentId: string | null
  depth: number
}>

export type WorkbenchNavigationProjection = Readonly<{
  topLevel: readonly WorkbenchNavigationTopLevelProjection[]
  rows: readonly WorkbenchNavigationRow[]
  leaves: readonly WorkbenchNavigationLeafProjection[]
}>

/** Validates and freezes navigation metadata before component rendering. */
export function normalizeWorkbenchNavigationItems(
  label: string,
  value: unknown,
): readonly WorkbenchNavigationItem[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} items must be an array`)
  const itemIds = new Set<string>()
  const groups = new Map<string, WorkbenchNavigationGroup>()
  const items = value.map((candidate, index): WorkbenchNavigationItem => {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`${label} item ${index} must be an object`)
    }
    const item = candidate as WorkbenchNavigationItem
    const id = requiredText(`${label} item id`, item.id)
    if (itemIds.has(id)) throw new Error(`Duplicate ${label.toLowerCase()} item id: ${id}`)
    itemIds.add(id)

    if (item.parentId !== undefined && item.group !== undefined) throw new Error(`${label} item cannot have both parentId and group`)
    let group: WorkbenchNavigationGroup | undefined
    if (item.group !== undefined) {
      if (item.group === null || typeof item.group !== "object") {
        throw new TypeError(`${label} item group must be an object`)
      }
      const groupId = requiredText(`${label} group id`, item.group.id)
      const groupLabel = requiredText(`${label} group label`, item.group.label)
      const current = groups.get(groupId)
      if (current !== undefined && current.label !== groupLabel) {
        throw new Error(`Conflicting ${label.toLowerCase()} group label for id: ${groupId}`)
      }
      group = current ?? Object.freeze({id: groupId, label: groupLabel})
      groups.set(groupId, group)
    }

    return Object.freeze({
      id,
      label: requiredText(`${label} item label`, item.label),
      route: requiredText(`${label} item route`, item.route),
      ...(item.title === undefined
        ? {}
        : {title: stringValue(`${label} item title`, item.title)}),
      ...(item.disabled === undefined ? {} : {disabled: Boolean(item.disabled)}),
      ...(item.searchText === undefined
        ? {}
        : {searchText: stringValue(`${label} item searchText`, item.searchText)}),
      ...(group === undefined ? {} : {group}),
      ...(item.parentId === undefined ? {} : {parentId: requiredText(`${label} parent id`, item.parentId)}),
    })
  })
  const parents = new Map(items.map(item => [item.id, item.parentId]))
  for (const item of items) {
    const seen = new Set([item.id])
    let parent = item.parentId
    while (parent !== undefined) {
      if (!parents.has(parent)) throw new Error(`Unknown ${label} parent: ${parent}`)
      if (seen.has(parent)) throw new Error(`Cyclic ${label} navigation: ${parent}`)
      seen.add(parent)
      parent = parents.get(parent)
    }
  }
  return Object.freeze(items)
}

/** Derives visible semantic rows without constructing or owning DOM nodes. */
export function projectWorkbenchNavigation(
  items: readonly WorkbenchNavigationItem[],
  query: string,
  collapsedGroupIds: ReadonlySet<string>,
): WorkbenchNavigationProjection {
  const normalizedQuery = normalizeWorkbenchNavigationSearch(query)
  type Node = {id: string; item?: WorkbenchNavigationItem; group?: WorkbenchNavigationGroup; parentId: string | null; children: Node[]}
  const nodes = new Map<string, Node>()
  const order = new Map<string, number>()
  const top: Node[] = []
  for (const [index, item] of items.entries()) {
    order.set(`leaf:${item.id}`, index)
    if (item.group !== undefined && !nodes.has(`group:${item.group.id}`)) {
      const node: Node = {id: item.group.id, group: item.group, parentId: null, children: []}
      nodes.set(`group:${node.id}`, node)
      order.set(`group:${node.id}`, index)
      top.push(node)
    }
    nodes.set(`leaf:${item.id}`, {id: item.id, item, parentId: item.parentId ?? item.group?.id ?? null, children: []})
  }
  for (const item of items) {
    const node = nodes.get(`leaf:${item.id}`)!
    if (node.parentId === null) top.push(node)
    else nodes.get(item.parentId === undefined ? `group:${node.parentId}` : `leaf:${node.parentId}`)!.children.push(node)
  }
  const rows: WorkbenchNavigationRow[] = []
  const leaves: WorkbenchNavigationLeafProjection[] = []
  const visit = (node: Node, depth: number): WorkbenchNavigationTopLevelProjection | null => {
    const childEntries = node.children.map(child => visit(child, depth + 1)).filter(entry => entry !== null)
    const matched = node.item === undefined
      ? normalizeWorkbenchNavigationSearch(node.group!.label).includes(normalizedQuery)
      : matches(node.item, normalizedQuery)
    if (!matched && childEntries.length === 0) return null
    if (node.group !== undefined || node.children.length > 0) {
      return Object.freeze({kind: "group", group: node.group ?? {id: node.id, label: node.item!.label, item: node.item!},
        items: Object.freeze(childEntries.flatMap(entry => entry.kind === "leaf" ? [entry.item] : entry.group.item ? [entry.group.item] : [])),
        children: Object.freeze(childEntries), parentId: node.parentId, depth})
    }
    return Object.freeze({kind: "leaf", item: node.item!, parentId: node.parentId, depth})
  }
  top.sort((left, right) => order.get(`${left.item === undefined ? "group" : "leaf"}:${left.id}`)! - order.get(`${right.item === undefined ? "group" : "leaf"}:${right.id}`)!)
  const topLevel = top.map(node => visit(node, 1)).filter(entry => entry !== null)
  const append = (entry: WorkbenchNavigationTopLevelProjection): void => {
    if (entry.kind === "leaf") {
      leaves.push(entry)
      rows.push(Object.freeze({kind: "leaf", id: entry.item.id, item: entry.item, parentId: entry.parentId, depth: entry.depth}))
      return
    }
    rows.push(Object.freeze({kind: "group", id: entry.group.id, group: entry, parentId: entry.parentId, depth: entry.depth}))
    if (!collapsedGroupIds.has(entry.group.id)) for (const child of entry.children) append(child)
  }
  for (const entry of topLevel) append(entry)
  return Object.freeze({topLevel: Object.freeze(topLevel), rows: Object.freeze(rows), leaves: Object.freeze(leaves)})
}

export function workbenchNavigationRowEnabled(row: WorkbenchNavigationRow): boolean {
  return row.kind === "group" || !row.item.disabled
}

export function workbenchNavigationRowKey(
  row: WorkbenchNavigationRow | undefined,
): string | null {
  if (row === undefined) return null
  return row.kind === "group"
    ? workbenchNavigationGroupKey(row.id)
    : workbenchNavigationLeafKey(row.id)
}

export function workbenchNavigationGroupKey(id: string): string {
  return `group:${id}`
}

export function workbenchNavigationLeafKey(id: string): string {
  return `leaf:${id}`
}

export function normalizeWorkbenchNavigationSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU")
}

function matches(item: WorkbenchNavigationItem, query: string): boolean {
  if (query.length === 0) return true
  return normalizeWorkbenchNavigationSearch([
    item.label,
    item.title ?? "",
    item.route,
    item.searchText ?? "",
  ].join(" ")).includes(query)
}

function requiredText(label: string, value: unknown): string {
  const text = stringValue(label, value)
  if (text.trim().length === 0) throw new Error(`${label} must not be empty`)
  return text
}

function stringValue(label: string, value: unknown): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`)
  return value
}
