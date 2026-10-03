import type {WebMinimap} from "@web/minimap"

/**
Читает сохранённые настройки Minimap текущего origin без выбора раскладки.
Проверка полей и начальные значения принадлежат самому Minimap. Недоступный
localStorage не мешает открывать окно или менять его положение.
*/
export function createMinimapPersistence(storage: () => Pick<Storage, "getItem" | "setItem">) {
  const key = "storybook.minimap.v1"
  let initialState: NonNullable<WebMinimap.Input["initialState"]> | undefined
  try {
    const value = JSON.parse(storage().getItem(key) ?? "null")
    if (value && typeof value === "object" && !Array.isArray(value)) {
      initialState = value as NonNullable<WebMinimap.Input["initialState"]>
    }
  } catch {}
  return {
    initialState,
    save(state: WebMinimap.Output): void {
      try { storage().setItem(key, JSON.stringify(state)) } catch {}
    },
  }
}
