import type {Item, Group} from "./navigation"

/** Формы результата чистой проекции каталога без владения DOM. */
export type NavigationGroupProjection = Readonly<{
  kind: "group"
  group: Group
  items: readonly Item[]
  children: readonly NavigationTopLevelProjection[]
  parentId: string | null
  depth: number
}>

export type NavigationLeafProjection = Readonly<{
  kind: "leaf"
  item: Item
  parentId: string | null
  depth: number
}>

export type NavigationTopLevelProjection =
  | NavigationGroupProjection
  | NavigationLeafProjection

export type NavigationRow = Readonly<{
  kind: "group"
  id: string
  group: NavigationGroupProjection
  parentId: string | null
  depth: number
}> | Readonly<{
  kind: "leaf"
  id: string
  item: Item
  parentId: string | null
  depth: number
}>

export type NavigationProjection = Readonly<{
  topLevel: readonly NavigationTopLevelProjection[]
  rows: readonly NavigationRow[]
  leaves: readonly NavigationLeafProjection[]
}>
