import {
  type Document,
  type Element,
  type Event,
  type HTMLButtonElement,
  type HTMLDivElement,
  type HTMLElement,
  type KeyboardEvent,
  type Node,
  type Text,
} from "@zavx0z/dom"

export type StorybookDomNavigationGroup = Readonly<{
  id: string
  label: string
}>

export type StorybookDomNavigationItem = Readonly<{
  id: string
  label: string
  route: string
  title?: string
  disabled?: boolean
  searchText?: string
  group?: StorybookDomNavigationGroup
}>

type GroupProjection = Readonly<{
  kind: "group"
  group: StorybookDomNavigationGroup
  items: readonly StorybookDomNavigationItem[]
}>

type LeafProjection = Readonly<{
  kind: "leaf"
  item: StorybookDomNavigationItem
  parentId: string | null
}>

type TopLevelProjection = GroupProjection | LeafProjection
type MutableGroupProjection = {
  kind: "group"
  group: StorybookDomNavigationGroup
  items: StorybookDomNavigationItem[]
}
type NavigationRow = Readonly<{
  kind: "group"
  id: string
  group: GroupProjection
}> | Readonly<{
  kind: "leaf"
  id: string
  item: StorybookDomNavigationItem
  parentId: string | null
}>

type Projection = Readonly<{
  topLevel: readonly TopLevelProjection[]
  rows: readonly NavigationRow[]
  leaves: readonly LeafProjection[]
}>

type GroupRecord = {
  group: StorybookDomNavigationGroup
  element: HTMLDivElement
  button: HTMLButtonElement
  disclosure: Text
  label: Text
  items: HTMLDivElement
  spacers: HTMLDivElement[]
  onClick: () => void
}

type LeafRecord = {
  item: StorybookDomNavigationItem
  button: HTMLButtonElement
  text: Text
  onClick: () => void
}

export type StorybookDomNavigationTree = Readonly<{
  updateItems(items: readonly StorybookDomNavigationItem[]): void
  setActive(id: string | null): void
  setQuery(query: string): void
  hasItem(id: string): boolean
  dispose(): void
}>

export type CreateStorybookDomNavigationTreeOptions = Readonly<{
  document: Document
  host: HTMLDivElement
  onNavigate(item: StorybookDomNavigationItem, source: HTMLButtonElement): void
  onGroupToggle(
    group: StorybookDomNavigationGroup,
    collapsed: boolean,
    source: HTMLElement,
  ): void
}>

const ROW_HEIGHT = 24
const WINDOW_SIZE = 80
const WINDOW_OVERSCAN = 12
const FOCUS_VIEW_ROWS = 20

/**
 * Validates and freezes navigation metadata before it reaches the semantic
 * tree. Repeated identical group descriptors are expected because every leaf
 * names its parent; conflicting descriptors fail before DOM mutation.
 */
export function normalizeStorybookDomNavigationItems(
  label: string,
  value: unknown,
): readonly StorybookDomNavigationItem[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} items must be an array`)
  const itemIds = new Set<string>()
  const groups = new Map<string, StorybookDomNavigationGroup>()
  const items = value.map((candidate, index): StorybookDomNavigationItem => {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`${label} item ${index} must be an object`)
    }
    const item = candidate as StorybookDomNavigationItem
    const id = requiredText(`${label} item id`, item.id)
    if (itemIds.has(id)) throw new Error(`Duplicate ${label.toLowerCase()} item id: ${id}`)
    itemIds.add(id)

    let group: StorybookDomNavigationGroup | undefined
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

/** Creates the catalog-only ARIA tree inside an existing Workbench host. */
export function createStorybookDomNavigationTree(
  options: CreateStorybookDomNavigationTreeOptions,
): StorybookDomNavigationTree {
  const {document, host} = options
  const groups = new Map<string, GroupRecord>()
  const leaves = new Map<string, LeafRecord>()
  const rowKeys = new Map<HTMLElement, string>()
  const rootSpacers: HTMLDivElement[] = []
  let items: readonly StorybookDomNavigationItem[] = Object.freeze([])
  let itemsById = new Map<string, StorybookDomNavigationItem>()
  let collapsedGroupIds = new Set<string>()
  let activeId: string | null = null
  let query = ""
  let focusKey: string | null = null
  let windowStart = 0
  let createdLeaves = 0
  let programmaticScrollTop: number | null = null
  let disposed = false

  host.setAttribute("role", "tree")
  host.setAttribute("data-storybook-tree", "catalog")

  const onKeyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent
    if (!isTreeKey(keyboard.key)) return
    const projection = project(items, query, collapsedGroupIds)
    const enabled = projection.rows.filter(rowEnabled)
    if (enabled.length === 0) return
    const currentKey = rowKeyForTarget(keyboard.target) ?? focusKey
    const currentIndex = enabled.findIndex((row) => rowKey(row) === currentKey)

    if (
      keyboard.key === "ArrowDown" ||
      keyboard.key === "ArrowUp" ||
      keyboard.key === "Home" ||
      keyboard.key === "End"
    ) {
      keyboard.preventDefault()
      let next: NavigationRow
      if (keyboard.key === "Home") next = enabled[0]!
      else if (keyboard.key === "End") next = enabled.at(-1)!
      else {
        const direction = keyboard.key === "ArrowDown" ? 1 : -1
        const origin = currentIndex < 0 ? (direction > 0 ? -1 : 0) : currentIndex
        next = enabled[(origin + direction + enabled.length) % enabled.length]!
      }
      focusRow(next)
      return
    }

    const current = projection.rows.find((row) => rowKey(row) === currentKey)
    if (current === undefined) return
    if (keyboard.key === "ArrowLeft") {
      keyboard.preventDefault()
      if (current.kind === "group" && !collapsedGroupIds.has(current.id)) {
        toggleGroup(current.group.group, true, true)
      } else if (current.kind === "leaf" && current.parentId !== null) {
        const parent = projection.rows.find((row) => row.kind === "group" && row.id === current.parentId)
        if (parent !== undefined) focusRow(parent)
      }
      return
    }
    if (keyboard.key === "ArrowRight") {
      keyboard.preventDefault()
      if (current.kind !== "group") return
      if (collapsedGroupIds.has(current.id)) {
        toggleGroup(current.group.group, false, true)
        return
      }
      const child = projection.rows.find((row) =>
        row.kind === "leaf" && row.parentId === current.id && rowEnabled(row))
      if (child !== undefined) focusRow(child)
      return
    }
    if (!isActivationKey(keyboard.key)) return
    keyboard.preventDefault()
    if (current.kind === "group") {
      toggleGroup(current.group.group, !collapsedGroupIds.has(current.id), true)
    } else if (!current.item.disabled) {
      activateLeaf(current.item, true)
    }
  }

  const onFocusIn = (event: Event): void => {
    const key = rowKeyForTarget(event.target)
    if (key === null) return
    document.transaction(() => {
      focusKey = key
      syncTabIndexes(project(items, query, collapsedGroupIds))
    })
  }

  host.addEventListener("keydown", onKeyDown)
  host.addEventListener("focusin", onFocusIn)
  const unsubscribeState = document.subscribeStateChanges((batch) => {
    if (disposed) return
    const scrolled = batch.records.some((record) => record.type === "scroll" && record.target === host)
    if (!scrolled) return
    if (programmaticScrollTop !== null && host.scrollTop === programmaticScrollTop) {
      programmaticScrollTop = null
      return
    }
    programmaticScrollTop = null
    const projection = project(items, query, collapsedGroupIds)
    const maximum = Math.max(0, projection.rows.length - WINDOW_SIZE)
    const next = clamp(
      Math.floor(host.scrollTop / ROW_HEIGHT) - WINDOW_OVERSCAN,
      0,
      maximum,
    )
    if (next === windowStart) return
    windowStart = next
    document.transaction(() => reconcile(projection, false))
  })

  const updateItems = (next: readonly StorybookDomNavigationItem[]): void => {
    assertActive()
    const hadTreeFocus = hasTreeFocus()
    const previousFocusedItem = itemForLeafKey(focusKey)
    items = next
    itemsById = new Map(next.map((item) => [item.id, item] as const))
    const nextGroups = new Set(next.flatMap((item) => item.group === undefined ? [] : [item.group.id]))
    collapsedGroupIds = new Set([...collapsedGroupIds].filter((id) => nextGroups.has(id)))
    if (activeId !== null && !itemsById.has(activeId)) activeId = null
    pruneRecords(nextGroups)
    const projection = project(items, query, collapsedGroupIds)
    repairFocus(projection, previousFocusedItem)
    if (hadTreeFocus && focusKey !== null) ensureRowWindow(projection, focusKey)
    else if (activeId !== null) ensureRowWindow(projection, leafKey(activeId))
    reconcile(projection, hadTreeFocus)
  }

  const setActive = (id: string | null): void => {
    assertActive()
    if (id !== null && !itemsById.has(id)) throw new Error(`Unknown catalog item id: ${id}`)
    activeId = id
    const projection = project(items, query, collapsedGroupIds)
    if (focusKey === null && id !== null) focusKey = leafKey(id)
    if (id !== null) ensureRowWindow(projection, leafKey(id))
    reconcile(projection, false)
  }

  const setQuery = (value: string): void => {
    assertActive()
    const hadTreeFocus = hasTreeFocus()
    const previousFocusedItem = itemForLeafKey(focusKey)
    query = normalizeSearch(value)
    setWindowStart(0, true)
    const projection = project(items, query, collapsedGroupIds)
    repairFocus(projection, previousFocusedItem)
    if (hadTreeFocus && focusKey !== null) ensureRowWindow(projection, focusKey)
    reconcile(projection, hadTreeFocus)
  }

  const hasItem = (id: string): boolean => itemsById.has(id)

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubscribeState()
    host.removeEventListener("keydown", onKeyDown)
    host.removeEventListener("focusin", onFocusIn)
    for (const record of groups.values()) record.button.removeEventListener("click", record.onClick)
    for (const record of leaves.values()) record.button.removeEventListener("click", record.onClick)
    groups.clear()
    leaves.clear()
    rowKeys.clear()
    rootSpacers.length = 0
  }

  function reconcile(projection: Projection, restoreFocus: boolean): void {
    const clampedWindowStart = clamp(
      windowStart,
      0,
      Math.max(0, projection.rows.length - WINDOW_SIZE),
    )
    if (clampedWindowStart !== windowStart) setWindowStart(clampedWindowStart, true)
    const windowEnd = Math.min(projection.rows.length, windowStart + WINDOW_SIZE)
    const preserveFocus = restoreFocus || hasTreeFocus()
    const focusedRow = preserveFocus && focusKey !== null
      ? projection.rows.findIndex((row) => rowKey(row) === focusKey)
      : -1
    const materializes = (index: number): boolean =>
      (index >= windowStart && index < windowEnd) || index === focusedRow
    const materializedIds = new Set(projection.rows
      .flatMap((row, index) => row.kind === "leaf" && materializes(index) ? [row.item.id] : []))
    const rootChildren: Node[] = []
    let rootSpacerIndex = 0
    let pendingRootRows = 0
    let rowIndex = 0

    const flushRootSpacer = (): void => {
      if (pendingRootRows === 0) return
      const spacer = rootSpacers[rootSpacerIndex] ?? createSpacer(document)
      rootSpacers[rootSpacerIndex] = spacer
      rootSpacerIndex += 1
      configureSpacer(spacer, pendingRootRows)
      rootChildren.push(spacer)
      pendingRootRows = 0
    }

    for (const entry of projection.topLevel) {
      if (entry.kind === "leaf") {
        const visible = materializes(rowIndex)
        rowIndex += 1
        if (!visible) {
          pendingRootRows += 1
          continue
        }
        flushRootSpacer()
        rootChildren.push(ensureLeafRecord(entry.item, null).button)
        continue
      }
      const collapsed = collapsedGroupIds.has(entry.group.id)
      const blockStart = rowIndex
      const blockEnd = blockStart + 1 + (collapsed ? 0 : entry.items.length)
      rowIndex = blockEnd
      const intersectsWindow = blockEnd > windowStart && blockStart < windowEnd
      const containsFocus = focusedRow >= blockStart && focusedRow < blockEnd
      if (!intersectsWindow && !containsFocus) {
        pendingRootRows += blockEnd - blockStart
        continue
      }
      flushRootSpacer()
      const record = ensureGroupRecord(entry)
      updateGroupRecord(record, entry)
      rootChildren.push(record.element)
      record.items.setAttribute("style", collapsed ? "display: none" : "display: flex")
      if (collapsed) {
        orderChildren(record.items, [])
        continue
      }
      const groupChildren: Node[] = []
      let groupSpacerIndex = 0
      let pendingGroupRows = 0
      const flushGroupSpacer = (): void => {
        if (pendingGroupRows === 0) return
        const spacer = record.spacers[groupSpacerIndex] ?? createSpacer(document)
        record.spacers[groupSpacerIndex] = spacer
        groupSpacerIndex += 1
        configureSpacer(spacer, pendingGroupRows)
        groupChildren.push(spacer)
        pendingGroupRows = 0
      }
      for (const [offset, item] of entry.items.entries()) {
        const itemRow = blockStart + 1 + offset
        if (!materializes(itemRow)) {
          pendingGroupRows += 1
          continue
        }
        flushGroupSpacer()
        groupChildren.push(ensureLeafRecord(item, entry.group.id).button)
      }
      flushGroupSpacer()
      record.spacers.length = groupSpacerIndex
      orderChildren(record.items, groupChildren)
    }
    flushRootSpacer()
    rootSpacers.length = rootSpacerIndex
    orderChildren(host, rootChildren)

    for (const record of leaves.values()) updateLeafRecord(record)
    syncTabIndexes(projection)
    host.setAttribute("data-storybook-tree-total", String(projection.leaves.length))
    host.setAttribute("data-storybook-tree-total-rows", String(projection.rows.length))
    host.setAttribute("data-storybook-tree-materialized", String(materializedIds.size))
    host.setAttribute("data-storybook-tree-created", String(createdLeaves))
    host.setAttribute("data-storybook-tree-window-start", String(windowStart))
    if (restoreFocus && focusKey !== null) rowButton(focusKey)?.focus({focusVisible: true})
  }

  function ensureGroupRecord(projection: GroupProjection): GroupRecord {
    const existing = groups.get(projection.group.id)
    if (existing !== undefined) return existing
    const wrapper = domElement(document, "div", "storybook-dom-workbench__group") as HTMLDivElement
    const button = domElement(document, "button", "storybook-dom-workbench__group-toggle") as HTMLButtonElement
    const disclosureElement = domElement(document, "span", "storybook-dom-workbench__disclosure")
    const disclosure = document.createTextNode("")
    const labelElement = domElement(document, "span", "storybook-dom-workbench__group-label")
    const label = document.createTextNode("")
    const childItems = domElement(document, "div", "storybook-dom-workbench__group-items") as HTMLDivElement
    wrapper.setAttribute("role", "treeitem")
    wrapper.setAttribute("aria-level", "1")
    button.type = "button"
    button.tabIndex = -1
    button.setAttribute("role", "presentation")
    disclosureElement.setAttribute("aria-hidden", "true")
    disclosureElement.appendChild(disclosure)
    labelElement.appendChild(label)
    button.appendChild(disclosureElement)
    button.appendChild(labelElement)
    childItems.setAttribute("role", "group")
    wrapper.appendChild(button)
    wrapper.appendChild(childItems)
    const record: GroupRecord = {
      group: projection.group,
      element: wrapper,
      button,
      disclosure,
      label,
      items: childItems,
      spacers: [],
      onClick: () => {
        const current = groups.get(projection.group.id)
        if (current === undefined) return
        focusKey = groupKey(current.group.id)
        toggleGroup(current.group, !collapsedGroupIds.has(current.group.id), true)
      },
    }
    button.addEventListener("click", record.onClick)
    groups.set(projection.group.id, record)
    rowKeys.set(wrapper, groupKey(projection.group.id))
    return record
  }

  function updateGroupRecord(record: GroupRecord, projection: GroupProjection): void {
    record.group = projection.group
    const collapsed = collapsedGroupIds.has(projection.group.id)
    record.label.data = projection.group.label
    record.disclosure.data = collapsed ? "▸" : "▾"
    record.element.title = projection.group.label
    record.element.setAttribute("data-group-id", projection.group.id)
    record.element.setAttribute("aria-label", projection.group.label)
    record.element.setAttribute("aria-expanded", String(!collapsed))
    record.button.title = projection.group.label
    record.button.setAttribute("data-group-id", projection.group.id)
    record.items.setAttribute("data-group-id", projection.group.id)
    record.items.setAttribute("aria-label", projection.group.label)
  }

  function ensureLeafRecord(item: StorybookDomNavigationItem, parentId: string | null): LeafRecord {
    let record = leaves.get(item.id)
    if (record === undefined) {
      const button = domElement(document, "button", "storybook-dom-workbench__item") as HTMLButtonElement
      const text = document.createTextNode("")
      button.type = "button"
      button.setAttribute("role", "treeitem")
      button.appendChild(text)
      record = {
        item,
        button,
        text,
        onClick: () => {
          const current = leaves.get(item.id)
          if (current === undefined || current.item.disabled) return
          activateLeaf(current.item, true)
        },
      }
      button.addEventListener("click", record.onClick)
      leaves.set(item.id, record)
      rowKeys.set(button, leafKey(item.id))
      createdLeaves += 1
    }
    record.item = item
    record.button.className = parentId === null
      ? "storybook-dom-workbench__item"
      : "storybook-dom-workbench__item storybook-dom-workbench__item--nested"
    record.button.setAttribute("aria-level", parentId === null ? "1" : "2")
    return record
  }

  function updateLeafRecord(record: LeafRecord): void {
    const item = itemsById.get(record.item.id)
    if (item === undefined) return
    record.item = item
    record.text.data = item.label
    record.button.title = item.title ?? item.label
    record.button.disabled = item.disabled ?? false
    record.button.setAttribute("data-id", item.id)
    record.button.setAttribute("data-route", item.route)
    record.button.setAttribute("aria-label", item.label)
    record.button.setAttribute("aria-disabled", String(item.disabled === true))
    const selected = item.id === activeId
    setPresence(record.button, "data-active", selected)
    if (selected) record.button.setAttribute("aria-current", "page")
    else record.button.removeAttribute("aria-current")
  }

  function toggleGroup(
    group: StorybookDomNavigationGroup,
    collapsed: boolean,
    restoreFocus: boolean,
  ): void {
    if (collapsed === collapsedGroupIds.has(group.id)) return
    document.transaction(() => {
      const next = new Set(collapsedGroupIds)
      if (collapsed) next.add(group.id)
      else next.delete(group.id)
      collapsedGroupIds = next
      if (collapsed) {
        const focused = itemForLeafKey(focusKey)
        if (focused?.group?.id === group.id) focusKey = groupKey(group.id)
      }
      const projection = project(items, query, collapsedGroupIds)
      repairFocus(projection, null)
      ensureRowWindow(projection, groupKey(group.id))
      reconcile(projection, restoreFocus)
    })
    const record = groups.get(group.id)
    if (record !== undefined) options.onGroupToggle(record.group, collapsed, record.element)
  }

  function activateLeaf(item: StorybookDomNavigationItem, restoreFocus: boolean): void {
    if (item.disabled) return
    document.transaction(() => {
      focusKey = leafKey(item.id)
      const projection = project(items, query, collapsedGroupIds)
      ensureRowWindow(projection, focusKey)
      reconcile(projection, restoreFocus)
      const record = leaves.get(item.id)
      if (record !== undefined) options.onNavigate(record.item, record.button)
    })
  }

  function focusRow(row: NavigationRow): void {
    const key = row.kind === "group" ? groupKey(row.id) : leafKey(row.id)
    document.transaction(() => {
      focusKey = key
      const projection = project(items, query, collapsedGroupIds)
      ensureRowWindow(projection, key)
      reconcile(projection, true)
    })
  }

  function repairFocus(
    projection: Projection,
    previousFocusedItem: StorybookDomNavigationItem | null,
  ): void {
    const enabled = projection.rows.filter(rowEnabled)
    if (focusKey !== null && enabled.some((row) => rowKey(row) === focusKey)) return
    const parentId = previousFocusedItem?.group?.id
    if (parentId !== undefined) {
      const parent = enabled.find((row) => row.kind === "group" && row.id === parentId)
      if (parent !== undefined) {
        focusKey = rowKey(parent)
        return
      }
    }
    const active = activeId === null
      ? undefined
      : enabled.find((row) => row.kind === "leaf" && row.id === activeId)
    focusKey = rowKey(active ?? enabled[0])
  }

  function ensureRowWindow(projection: Projection, key: string): void {
    const index = projection.rows.findIndex((row) => rowKey(row) === key)
    if (index < 0) return
    const firstVisible = Math.floor(host.scrollTop / ROW_HEIGHT)
    const visible = index >= firstVisible && index < firstVisible + FOCUS_VIEW_ROWS
    const materialized = index >= windowStart && index < windowStart + WINDOW_SIZE
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
    setWindowStart(nextWindowStart, true, scrollRow)
  }

  function setWindowStart(
    value: number,
    syncScroll: boolean,
    scrollRow = value,
  ): void {
    const next = Math.max(0, value)
    windowStart = next
    if (!syncScroll) return
    const scrollTop = Math.max(0, scrollRow) * ROW_HEIGHT
    if (host.scrollTop === scrollTop) {
      programmaticScrollTop = null
      return
    }
    programmaticScrollTop = scrollTop
    host.scrollTop = scrollTop
  }

  function syncTabIndexes(projection: Projection): void {
    const enabled = projection.rows.filter(rowEnabled)
    const resolved = focusKey !== null && enabled.some((row) => rowKey(row) === focusKey)
      ? focusKey
      : rowKey(enabled[0])
    focusKey = resolved
    for (const [id, record] of groups) {
      const focused = groupKey(id) === resolved
      record.element.tabIndex = focused ? 0 : -1
      setPresence(record.button, "data-focused", focused)
    }
    for (const [id, record] of leaves) {
      record.button.tabIndex = !record.item.disabled && leafKey(id) === resolved ? 0 : -1
    }
  }

  function pruneRecords(nextGroups: ReadonlySet<string>): void {
    for (const [id, record] of groups) {
      if (nextGroups.has(id)) continue
      record.button.removeEventListener("click", record.onClick)
      rowKeys.delete(record.element)
      if (record.element.parentNode !== null) record.element.parentNode.removeChild(record.element)
      groups.delete(id)
    }
    for (const [id, record] of leaves) {
      if (itemsById.has(id)) continue
      record.button.removeEventListener("click", record.onClick)
      rowKeys.delete(record.button)
      if (record.button.parentNode !== null) record.button.parentNode.removeChild(record.button)
      leaves.delete(id)
    }
  }

  function rowKeyForTarget(target: unknown): string | null {
    if (!(target instanceof Object)) return null
    return rowKeys.get(target as HTMLElement) ?? null
  }

  function rowButton(key: string): HTMLElement | undefined {
    if (key.startsWith("group:")) return groups.get(key.slice("group:".length))?.element
    if (key.startsWith("leaf:")) return leaves.get(key.slice("leaf:".length))?.button
    return undefined
  }

  function itemForLeafKey(key: string | null): StorybookDomNavigationItem | null {
    if (key === null || !key.startsWith("leaf:")) return null
    return itemsById.get(key.slice("leaf:".length)) ?? null
  }

  function hasTreeFocus(): boolean {
    const active = document.activeElement
    return active !== null && rowKeys.has(active as HTMLElement)
  }

  function assertActive(): void {
    if (disposed) throw new Error("DOM navigation tree is disposed")
  }

  return Object.freeze({updateItems, setActive, setQuery, hasItem, dispose})
}

function project(
  items: readonly StorybookDomNavigationItem[],
  query: string,
  collapsedGroupIds: ReadonlySet<string>,
): Projection {
  const topLevel: Array<MutableGroupProjection | LeafProjection> = []
  const groups = new Map<string, MutableGroupProjection>()
  for (const item of items) {
    if (item.group === undefined) {
      if (matches(item, query)) topLevel.push(Object.freeze({kind: "leaf", item, parentId: null}))
      continue
    }
    let group = groups.get(item.group.id)
    if (group === undefined) {
      group = {kind: "group", group: item.group, items: []}
      groups.set(item.group.id, group)
      topLevel.push(group)
    }
    if (matches(item, query)) group.items.push(item)
  }

  const normalizedTopLevel = topLevel.flatMap((entry): TopLevelProjection[] => {
    if (entry.kind === "leaf") return [entry]
    if (entry.items.length === 0 && !normalizeSearch(entry.group.label).includes(query)) return []
    return [Object.freeze({
      kind: "group" as const,
      group: entry.group,
      items: Object.freeze([...entry.items]),
    })]
  })
  const rows: NavigationRow[] = []
  const leaves: LeafProjection[] = []
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

function matches(item: StorybookDomNavigationItem, query: string): boolean {
  if (query.length === 0) return true
  return normalizeSearch([
    item.label,
    item.title ?? "",
    item.route,
    item.searchText ?? "",
  ].join(" ")).includes(query)
}

function rowEnabled(row: NavigationRow): boolean {
  return row.kind === "group" || !row.item.disabled
}

function rowKey(row: NavigationRow | undefined): string | null {
  if (row === undefined) return null
  return row.kind === "group" ? groupKey(row.id) : leafKey(row.id)
}

function groupKey(id: string): string {
  return `group:${id}`
}

function leafKey(id: string): string {
  return `leaf:${id}`
}

function isTreeKey(key: string): boolean {
  return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End" ||
    key === "ArrowLeft" || key === "ArrowRight" || isActivationKey(key)
}

function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Space" || key === "Spacebar"
}

function createSpacer(document: Document): HTMLDivElement {
  const spacer = domElement(document, "div", "storybook-dom-workbench__tree-spacer") as HTMLDivElement
  spacer.setAttribute("role", "presentation")
  spacer.setAttribute("aria-hidden", "true")
  return spacer
}

function configureSpacer(spacer: HTMLElement, rows: number): void {
  const height = rows * ROW_HEIGHT
  spacer.setAttribute("style", `display: block; height: ${height}px; min-height: ${height}px`)
}

function domElement(document: Document, tag: string, className: string): HTMLElement {
  const result = document.createElement(tag)
  result.className = className
  return result
}

function orderChildren(host: Node, children: readonly Node[]): void {
  const retained = new Set(children)
  for (const child of [...host.childNodes]) {
    if (!retained.has(child)) host.removeChild(child)
  }
  let cursor = host.firstChild
  for (const child of children) {
    if (child === cursor) {
      cursor = cursor.nextSibling
      continue
    }
    host.insertBefore(child, cursor)
  }
}

function setPresence(element: Element, name: string, present: boolean): void {
  if (present) element.setAttribute(name, "")
  else element.removeAttribute(name)
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU")
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
