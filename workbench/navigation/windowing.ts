import {
  projectWorkbenchNavigation,
  workbenchNavigationGroupKey,
  workbenchNavigationLeafKey,
  type WorkbenchNavigationGroupProjection,
  type WorkbenchNavigationItem,
  type WorkbenchNavigationLeafProjection,
  type WorkbenchNavigationProjection,
  type WorkbenchNavigationTopLevelProjection,
} from "./model.ts"

export const NAVIGATION_ROW_HEIGHT = 24
export const NAVIGATION_WINDOW_SIZE = 80
export const NAVIGATION_WINDOW_OVERSCAN = 12
export const NAVIGATION_FOCUS_VIEW_ROWS = 20

export type RootBlock = Readonly<{
  kind: "group"
  key: string
  projection: WorkbenchNavigationGroupProjection
  children: readonly RootBlock[]
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

export type GroupBlock = RootBlock

export function navigationRootBlockRows(block: RootBlock, collapsed: boolean): number {
  if (block.hidden) return 0
  if (block.kind === "spacer") return block.rows
  if (block.kind === "leaf" || collapsed) return 1
  return 1 + block.children.reduce((count, child) => count + navigationRootBlockRows(child, false), 0)
}

export function windowedBlocks(
  projection: WorkbenchNavigationProjection,
  windowStart: number,
  focusKey: string | null,
  collapsed: ReadonlySet<string>,
): readonly RootBlock[] {
  const indexes = new Map(projection.rows.map((row, index) => [`${row.kind}:${row.id}`, index]))
  const materialized = (key: string) => {
    const index = indexes.get(key)
    return index !== undefined && (key === focusKey || index >= windowStart && index < windowStart + NAVIGATION_WINDOW_SIZE)
  }
  const visit = (entries: readonly WorkbenchNavigationTopLevelProjection[]): readonly RootBlock[] => {
    const blocks: RootBlock[] = []
    let skipped = 0
    const flush = () => {
      if (skipped) blocks.push({kind: "spacer", key: `spacer:${blocks.length}:${skipped}`, rows: skipped, hidden: false})
      skipped = 0
    }
    for (const entry of entries) {
      const key = entry.kind === "leaf" ? workbenchNavigationLeafKey(entry.item.id) : workbenchNavigationGroupKey(entry.group.id)
      if (!indexes.has(key)) continue
      const children = entry.kind === "group" && !collapsed.has(entry.group.id) ? visit(entry.children) : []
      const visibleChild = children.some(child => child.kind !== "spacer")
      if (!materialized(key) && !visibleChild) {
        skipped += 1 + children.reduce((count, child) => count + navigationRootBlockRows(child, false), 0)
        continue
      }
      flush()
      blocks.push(entry.kind === "leaf" ? {kind: "leaf", key, leaf: entry, hidden: false} :
        {kind: "group", key, projection: entry, children, hidden: false})
    }
    flush()
    return Object.freeze(blocks)
  }
  return visit(projection.topLevel)
}

export function retainedBlocks(
  visible: readonly RootBlock[],
  items: readonly WorkbenchNavigationItem[],
  createdGroups: ReadonlySet<string>,
  createdLeaves: ReadonlySet<string>,
): readonly RootBlock[] {
  const complete = projectWorkbenchNavigation(items, "", new Set())
  const retain = (blocks: readonly RootBlock[], entries: readonly WorkbenchNavigationTopLevelProjection[]): readonly RootBlock[] => {
    const keys = new Set(blocks.map(block => block.key))
    const output: RootBlock[] = blocks.map(block => {
      if (block.kind !== "group") return block
      const entry = entries.find(entry => entry.kind === "group" && entry.group.id === block.projection.group.id)
      return {...block, children: retain(block.children, entry?.kind === "group" ? entry.children : [])}
    })
    for (const entry of entries) {
      const group = entry.kind === "group"
      const id = group ? entry.group.id : entry.item.id
      const key = group ? workbenchNavigationGroupKey(id) : workbenchNavigationLeafKey(id)
      if (keys.has(key) || !(group ? createdGroups.has(id) : createdLeaves.has(id))) continue
      output.push(group ? {kind: "group", key, projection: entry, children: retain([], entry.children), hidden: true} :
        {kind: "leaf", key, leaf: entry, hidden: true})
    }
    return Object.freeze(output)
  }
  return retain(visible, complete.topLevel)
}

export function materializedLeafCount(blocks: readonly RootBlock[]): number {
  return blocks.reduce((count, block) => count + (block.hidden ? 0 : block.kind === "leaf" ? 1 :
    block.kind === "group" ? materializedLeafCount(block.children) : 0), 0)
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
