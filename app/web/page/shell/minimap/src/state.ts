import type {WebMinimap} from "../contract"

/** Проверяет сохранённые настройки и создаёт собственную полную раскладку Minimap. */
export function normalizeMinimapState(input: unknown): WebMinimap.Output {
  const value = record(input)
  const position = record(value?.geometry)
  const savedTab = record(value?.tab)
  const geometry = {x: 8, y: 8, width: 300, height: 480}
  for (const field of ["x", "y", "width", "height"] as const) {
    const number = position?.[field]
    if (typeof number !== "number" || !Number.isFinite(number)) continue
    if (field === "x" || field === "y") geometry[field] = Math.max(0, number)
    else if (number > 0) geometry[field] = number
  }
  const edge = savedTab?.edge
  const tabEdge = edge === "left" || edge === "right" || edge === "top" || edge === "bottom" ? edge : "left"
  const offset = savedTab?.offset
  return {
    collapsed: typeof value?.collapsed === "boolean" ? value.collapsed : false,
    geometry,
    tab: {edge: tabEdge, offset: typeof offset === "number" && Number.isFinite(offset)
      ? Math.max(0, Math.min(1, offset)) : .5},
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}
