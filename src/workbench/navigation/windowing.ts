import {
  workbenchNavigationGroupKey,
  workbenchNavigationLeafKey,
  workbenchNavigationRowKey,
  type WorkbenchNavigationGroupProjection,
  type WorkbenchNavigationItem,
  type WorkbenchNavigationLeafProjection,
  type WorkbenchNavigationProjection,
} from "./model.ts"

export const NAVIGATION_ROW_HEIGHT = 24
export const NAVIGATION_WINDOW_SIZE = 80
export const NAVIGATION_WINDOW_OVERSCAN = 12
export const NAVIGATION_FOCUS_VIEW_ROWS = 20

export type RootBlock = Readonly<{
  kind: "group"
  key: string
  projection: WorkbenchNavigationGroupProjection
  children: readonly GroupBlock[]
  hidden: boolean
}> | Readonly<{
  kind: "leaf"
  key: string
  leaf: WorkbenchNavigationLeafProjection
  hidden: boolean
}> | Readonly<{
  kind: "spacer"
  key: string
  rows: number
  hidden: false
}>

export type GroupBlock = Readonly<{
  kind: "leaf"
  key: string
  leaf: WorkbenchNavigationLeafProjection
  hidden: boolean
}> | Readonly<{
  kind: "spacer"
  key: string
  rows: number
  hidden: false
}>

export function windowedBlocks(
  projection: WorkbenchNavigationProjection,
  windowStart: number,
  focusKey: string | null,
  collapsedGroupIds: ReadonlySet<string>,
): readonly RootBlock[] {
  const windowEnd = Math.min(projection.rows.length, windowStart + NAVIGATION_WINDOW_SIZE)
  const focusedRow = focusKey === null
    ? -1
    : projection.rows.findIndex(row => workbenchNavigationRowKey(row) === focusKey)
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
        output.push(Object.freeze({
          kind: "leaf",
          key: workbenchNavigationLeafKey(entry.item.id),
          leaf: entry,
          hidden: false,
        }))
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
          children.push(Object.freeze({
            kind: "spacer",
            key: `spacer:${spacerStart}:${pendingRows}`,
            rows: pendingRows,
            hidden: false,
          }))
          pendingRows = 0
        }
        children.push(Object.freeze({
          kind: "leaf",
          key: workbenchNavigationLeafKey(item.id),
          leaf: Object.freeze({kind: "leaf", item, parentId: entry.group.id}),
          hidden: false,
        }))
      }
      if (pendingRows > 0) {
        children.push(Object.freeze({
          kind: "spacer",
          key: `spacer:${spacerStart}:${pendingRows}`,
          rows: pendingRows,
          hidden: false,
        }))
      }
    }
    output.push(Object.freeze({
      kind: "group",
      key: workbenchNavigationGroupKey(entry.group.id),
      projection: entry,
      children: Object.freeze(children),
      hidden: false,
    }))
  }
  flushRootSpacer()
  return Object.freeze(output)
}

export function retainedBlocks(
  visible: readonly RootBlock[],
  items: readonly WorkbenchNavigationItem[],
  createdGroupIds: ReadonlySet<string>,
  createdLeafIds: ReadonlySet<string>,
): readonly RootBlock[] {
  const visibleRootKeys = new Set(visible.map(({key}) => key))
  const output: RootBlock[] = visible.map(block => {
    if (block.kind !== "group") return block
    const visibleChildKeys = new Set(block.children.map(({key}) => key))
    const retained = items.flatMap(item =>
      item.group?.id === block.projection.group.id && createdLeafIds.has(item.id) &&
        !visibleChildKeys.has(workbenchNavigationLeafKey(item.id))
        ? [Object.freeze({
            kind: "leaf" as const,
            key: workbenchNavigationLeafKey(item.id),
            leaf: Object.freeze({kind: "leaf" as const, item, parentId: item.group.id}),
            hidden: true,
          })]
        : [])
    return Object.freeze({...block, children: Object.freeze([...block.children, ...retained])})
  })

  for (const groupId of createdGroupIds) {
    const key = workbenchNavigationGroupKey(groupId)
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
            key: workbenchNavigationLeafKey(item.id),
            leaf: Object.freeze({kind: "leaf" as const, item, parentId: groupId}),
            hidden: true,
          })]
        : [])),
      hidden: true,
    }))
  }

  for (const item of items) {
    const key = workbenchNavigationLeafKey(item.id)
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

export function materializedLeafCount(blocks: readonly RootBlock[]): number {
  return blocks.reduce((count, block) => count + (
    block.kind === "leaf" && !block.hidden
      ? 1
      : block.kind === "group"
        ? block.children.filter(child => child.kind === "leaf" && !child.hidden).length
        : 0
  ), 0)
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
