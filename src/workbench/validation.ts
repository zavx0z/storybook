export function requiredText(label: string, value: unknown): string {
  const text = stringValue(label, value)
  if (text.trim().length === 0) throw new Error(`${label} must not be empty`)
  return text
}

export function stringValue(label: string, value: unknown): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`)
  return value
}

export function selectedId(
  label: string,
  value: unknown,
  items: readonly Readonly<{id: string}>[],
): string | null {
  if (value === null) return null
  const id = requiredText(`${label} active id`, value)
  if (!items.some(item => item.id === id)) {
    throw new Error(`Unknown ${label.toLowerCase()} item id: ${id}`)
  }
  return id
}
