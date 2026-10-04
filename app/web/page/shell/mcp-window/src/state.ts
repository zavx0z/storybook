import type {StorybookAppWebPageShellMcpWindow} from "../contract"

/** Дополняет сохранённые поля настройками окна и распознаёт прежнее сворачивание. */
export function normalizeMcpWindowState(input: unknown): StorybookAppWebPageShellMcpWindow.Output {
  const value = record(input)
  const savedGeometry = record(value?.geometry)
  const geometry = {x: 24, y: 24, width: 620, height: 400}
  for (const field of ["x", "y", "width", "height"] as const) {
    const number = savedGeometry?.[field]
    if (typeof number !== "number" || !Number.isFinite(number)) continue
    const minimum = field === "width" ? 320 : field === "height" ? 200 : 0
    geometry[field] = Math.max(minimum, number)
  }
  return {
    open: value?.minimized === true ? false : value?.open === true,
    mode: value?.mode === "address" ? "address" : "agent",
    geometry,
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}
