/** Pure validation and projection for Workbench navigation. */

export type WorkbenchNavigationGroup = Readonly<{
  id: string
  label: string
}>

export type WorkbenchNavigationItem = Readonly<{
  id: string
  label: string
  route: string
  title?: string
  disabled?: boolean
  searchText?: string
  group?: WorkbenchNavigationGroup
}>

export type WorkbenchNavigationGroupProjection = Readonly<{
  kind: "group"
  group: WorkbenchNavigationGroup
  items: readonly WorkbenchNavigationItem[]
}>

export type WorkbenchNavigationLeafProjection = Readonly<{
  kind: "leaf"
  item: WorkbenchNavigationItem
  parentId: string | null
}>

export type WorkbenchNavigationTopLevelProjection =
  | WorkbenchNavigationGroupProjection
  | WorkbenchNavigationLeafProjection

export type WorkbenchNavigationRow = Readonly<{
  kind: "group"
  id: string
  group: WorkbenchNavigationGroupProjection
}> | Readonly<{
  kind: "leaf"
  id: string
  item: WorkbenchNavigationItem
  parentId: string | null
}>

export type WorkbenchNavigationProjection = Readonly<{
  topLevel: readonly WorkbenchNavigationTopLevelProjection[]
  rows: readonly WorkbenchNavigationRow[]
  leaves: readonly WorkbenchNavigationLeafProjection[]
}>

type MutableGroupProjection = {
  kind: "group"
  group: WorkbenchNavigationGroup
  items: WorkbenchNavigationItem[]
}

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
    })
  })
  return Object.freeze(items)
}

/** Derives visible semantic rows without constructing or owning DOM nodes. */
export function projectWorkbenchNavigation(
  items: readonly WorkbenchNavigationItem[],
  query: string,
  collapsedGroupIds: ReadonlySet<string>,
): WorkbenchNavigationProjection {
  const normalizedQuery = normalizeWorkbenchNavigationSearch(query)
  const topLevel: Array<MutableGroupProjection | WorkbenchNavigationLeafProjection> = []
  const groups = new Map<string, MutableGroupProjection>()
  for (const item of items) {
    if (item.group === undefined) {
      if (matches(item, normalizedQuery)) {
        topLevel.push(Object.freeze({kind: "leaf", item, parentId: null}))
      }
      continue
    }
    let group = groups.get(item.group.id)
    if (group === undefined) {
      group = {kind: "group", group: item.group, items: []}
      groups.set(item.group.id, group)
      topLevel.push(group)
    }
    if (matches(item, normalizedQuery)) group.items.push(item)
  }

  const normalizedTopLevel = topLevel.flatMap((entry): WorkbenchNavigationTopLevelProjection[] => {
    if (entry.kind === "leaf") return [entry]
    if (entry.items.length === 0 &&
      !normalizeWorkbenchNavigationSearch(entry.group.label).includes(normalizedQuery)) return []
    return [Object.freeze({
      kind: "group" as const,
      group: entry.group,
      items: Object.freeze([...entry.items]),
    })]
  })
  const rows: WorkbenchNavigationRow[] = []
  const leaves: WorkbenchNavigationLeafProjection[] = []
  for (const entry of normalizedTopLevel) {
    if (entry.kind === "leaf") {
      const row = Object.freeze({kind: "leaf" as const, id: entry.item.id, item: entry.item, parentId: null})
      rows.push(row)
      leaves.push(entry)
      continue
    }
    rows.push(Object.freeze({kind: "group", id: entry.group.id, group: entry}))
    if (collapsedGroupIds.has(entry.group.id)) continue
    for (const item of entry.items) {
      const leaf = Object.freeze({kind: "leaf" as const, item, parentId: entry.group.id})
      leaves.push(leaf)
      rows.push(Object.freeze({kind: "leaf", id: item.id, item, parentId: entry.group.id}))
    }
  }
  return Object.freeze({
    topLevel: Object.freeze(normalizedTopLevel),
    rows: Object.freeze(rows),
    leaves: Object.freeze(leaves),
  })
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
