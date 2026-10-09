import type {StorybookAppWebPageShellExecutionSettings as Contract} from "../contract"

/** Проверяет сохранённое положение; ограничение видимыми границами выполняет Window. */
export function windowState(input: Contract.Input["initialState"]): Parameters<NonNullable<Contract.Input["onStateChange"]>>[0] {
  const geometry = {x: 80, y: 60, width: 780, height: 540}
  for (const key of ["x", "y", "width", "height"] as const) {
    const value = input?.geometry?.[key]
    if (typeof value === "number" && Number.isFinite(value)) geometry[key] = Math.max(key === "width" ? 520 : key === "height" ? 320 : 0, value)
  }
  const edge = input?.tab?.edge
  const offset = input?.tab?.offset
  return {open: input?.open === true, geometry, tab: {
    edge: edge === "bottom" || edge === "left" || edge === "right" ? edge : "top",
    offset: typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.min(1, offset)) : .72,
  }}
}
