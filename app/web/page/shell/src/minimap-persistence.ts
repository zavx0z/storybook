import type {Zavx0zStorybookAppWebPageShellMinimap} from "@zavx0z/storybook-app-web-page-shell-minimap"

/**
Читает сохранённые настройки Minimap текущего origin без выбора раскладки.
Проверка полей и начальные значения принадлежат самому Minimap. Недоступный
localStorage не мешает открывать окно или менять его положение.
*/
export function createMinimapPersistence(storage: () => Pick<Storage, "getItem" | "setItem">) {
  const key = "storybook.minimap.v1"
  let initialState: NonNullable<Zavx0zStorybookAppWebPageShellMinimap.Input["initialState"]> | undefined
  try {
    const value = JSON.parse(storage().getItem(key) ?? "null")
    if (value && typeof value === "object" && !Array.isArray(value)) {
      initialState = value as NonNullable<Zavx0zStorybookAppWebPageShellMinimap.Input["initialState"]>
    }
  } catch {}
  return {
    initialState,
    save(state: Zavx0zStorybookAppWebPageShellMinimap.Output): void {
      try { storage().setItem(key, JSON.stringify(state)) } catch {}
    },
  }
}
