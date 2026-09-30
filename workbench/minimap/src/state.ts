import type {WindowGeometry} from "@zavx0z/ui/surfaces/window"
import type {TabProps} from "@zavx0z/ui/surfaces/tab"

/** Настройки Minimap между сессиями; данные каталога и временный pointer-жест сюда не входят. */
export interface MinimapState {
  readonly collapsed: boolean
  readonly geometry: WindowGeometry
  readonly tab: NonNullable<TabProps["position"]>
}

/** Начальная раскладка Minimap до первого сохранения настроек. */
export function defaultMinimapState(): MinimapState {
  return {collapsed: false, geometry: {x: 8, y: 8, width: 300, height: 480}, tab: {edge: "left", offset: .5}}
}

/**
Читает настройки Minimap текущего origin; повреждённые поля получают defaults.
Сохраняет только завершённые изменения, переданные компонентом. Недоступный
localStorage не мешает открывать окно или менять его положение.
*/
export function createMinimapPersistence(storage: () => Pick<Storage, "getItem" | "setItem">) {
  const key = "storybook.minimap.v1"
  const defaults = defaultMinimapState()
  let initialState = defaults
  try {
    const value = JSON.parse(storage().getItem(key) ?? "null")
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const geometry = {...defaults.geometry}
      for (const field of ["x", "y", "width", "height"] as const) {
        const number = value.geometry?.[field]
        if (typeof number !== "number" || !Number.isFinite(number)) continue
        if (field === "x" || field === "y") geometry[field] = Math.max(0, number)
        else if (number > 0) geometry[field] = number
      }
      const tab = {...defaults.tab}
      if (["left", "right", "top", "bottom"].includes(value.tab?.edge)) tab.edge = value.tab.edge
      if (typeof value.tab?.offset === "number" && Number.isFinite(value.tab.offset)) tab.offset = Math.max(0, Math.min(1, value.tab.offset))
      initialState = {collapsed: typeof value.collapsed === "boolean" ? value.collapsed : defaults.collapsed, geometry, tab}
    }
  } catch {}
  return {
    initialState,
    save(state: MinimapState): void {
      try { storage().setItem(key, JSON.stringify(state)) } catch {}
    },
  }
}
