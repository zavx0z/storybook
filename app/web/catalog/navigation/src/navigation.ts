import type {Item} from "../contract/navigation"
import type {NavigationRow} from "../contract/projection"

export function navigationRowEnabled(row: NavigationRow): boolean {
  return row.kind === "group" || !row.item.disabled
}

export function navigationRowKey(
  row: NavigationRow | undefined,
): string | null {
  if (row === undefined) return null
  return row.kind === "group"
    ? navigationGroupKey(row.id)
    : navigationLeafKey(row.id)
}

export function navigationGroupKey(id: string): string {
  return `group:${id}`
}

export function navigationLeafKey(id: string): string {
  return `leaf:${id}`
}

export function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU")
}

export function matches(item: Item, query: string): boolean {
  if (query.length === 0) return true
  return normalizeSearch([
    item.label,
    item.title ?? "",
    item.route,
    item.searchText ?? "",
  ].join(" ")).includes(query)
}

export function requiredText(label: string, value: unknown): string {
  const text = stringValue(label, value)
  if (text.trim().length === 0) throw new Error(`${label} must not be empty`)
  return text
}

export function stringValue(label: string, value: unknown): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`)
  return value
}
