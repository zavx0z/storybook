import type {WorkbenchNavigationItem} from "./model.ts"

/**
Выбирает текущий узел и его потомков для каталога Display.
Полный каталог остаётся у общей модели и Minimap. Связи читаются по parentId,
без сравнения URL: похожие пути не делают узлы родственниками.
У корня снимается внешняя принадлежность; порядок и метаданные сохраняются.
Без выбранного узла возвращается полный каталог, неизвестный узел даёт пустую ветку.
*/
export function selectWorkbenchNavigationBranch(
  items: readonly WorkbenchNavigationItem[],
  rootId: string | null,
): readonly WorkbenchNavigationItem[] {
  if (rootId === null) return items
  if (!items.some(item => item.id === rootId)) return []
  const children = new Map<string, string[]>()
  for (const item of items) {
    if (item.parentId === undefined) continue
    const siblings = children.get(item.parentId) ?? []
    siblings.push(item.id)
    children.set(item.parentId, siblings)
  }
  const included = new Set([rootId])
  for (const id of included) {
    for (const child of children.get(id) ?? []) included.add(child)
  }
  return items.filter(item => included.has(item.id)).map(item => {
    if (item.id !== rootId) return item
    const {parentId, group, ...root} = item
    return root
  })
}
