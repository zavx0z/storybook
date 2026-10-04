/**
Проверяет навигационные данные и выводит видимую структуру каталога.
Сохраняет порядок узлов, связи родителей и предков поисковых совпадений;
закрытые ветви управляют видимостью строк. DOM, выбранная страница и сохранение
раскрытия остаются у потребителей результата.

@packageDocumentation
*/
import type {StorybookAppWebPageShellWorkbenchCatalogNavigation} from "./contract"
import type {Item, Group} from "./contract/navigation"
import type {NavigationLeafProjection, NavigationTopLevelProjection, NavigationRow, NavigationProjection} from "./contract/projection"
import {normalizeSearch, matches, requiredText, stringValue} from "./src/navigation"
export type {StorybookAppWebPageShellWorkbenchCatalogNavigation} from "./contract"

const Navigation: StorybookAppWebPageShellWorkbenchCatalogNavigation.Output = Object.freeze<StorybookAppWebPageShellWorkbenchCatalogNavigation.Output>({
  /**
Проверяет и замораживает навигационные данные до изменения модели или отрисовки.

@param label - Имя проверяемой области для диагностики.
@param value - Входной список структурных узлов.
@returns Неизменный список с проверенными идентификаторами и родительскими связями.
@throws TypeError При неправильной форме списка или его полей.
@throws Error При дублях, противоречивых группах, неизвестном родителе или цикле.
*/
  normalizeItems(
    label: string,
    value: unknown,
): readonly Item[] {
    if (!Array.isArray(value)) throw new TypeError(`${label} items must be an array`)
    const itemIds = new Set<string>()
    const groups = new Map<string, Group>()
    const items = value.map((candidate, index): Item => {
      if (candidate === null || typeof candidate !== "object") {
        throw new TypeError(`${label} item ${index} must be an object`)
      }
      const item = candidate as Item
      const id = requiredText(`${label} item id`, item.id)
      if (itemIds.has(id)) throw new Error(`Duplicate ${label.toLowerCase()} item id: ${id}`)
      itemIds.add(id)

      if (item.parentId !== undefined && item.group !== undefined) throw new Error(`${label} item cannot have both parentId and group`)
      let group: Group | undefined
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
        ...(item.expandable === undefined ? {} : {expandable: Boolean(item.expandable)}),
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
  },

  /**
Выводит видимые строки и сохраняет предков поисковых совпадений.

@param items - Проверенные структурные узлы в порядке каталога.
@param query - Поисковый запрос по подписи, подсказке, маршруту и дополнительному тексту.
@param collapsedGroupIds - Закрытые ветви, чьи дочерние строки не показываются.
@returns Дерево, видимые строки и листья без создания или изменения DOM.
*/
  projectNavigation(
    items: readonly Item[],
    query: string,
    collapsedGroupIds: ReadonlySet<string>,
): NavigationProjection {
    const normalizedQuery = normalizeSearch(query)
    type Node = {
      id: string
      item?: Item
      group?: Group
      parentId: string | null
      children: Node[]
    }
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
    const rows: NavigationRow[] = []
    const leaves: NavigationLeafProjection[] = []
    const visit = (node: Node, depth: number): NavigationTopLevelProjection | null => {
      const childEntries = node.children.map(child => visit(child, depth + 1)).filter(entry => entry !== null)
      const matched = node.item === undefined
        ? normalizeSearch(node.group!.label).includes(normalizedQuery)
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
    const append = (entry: NavigationTopLevelProjection): void => {
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
  },
})

export default Navigation
