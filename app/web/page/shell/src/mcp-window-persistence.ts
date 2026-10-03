import type {WebMcpWindow} from "@web/mcp-window"

/**
Хранит настройки окна в localStorage текущего origin. Проверка полей и
начальные значения принадлежат самому окну; недоступное хранилище не мешает ему.
*/
export function createMcpWindowPersistence(storage: () => Pick<Storage, "getItem" | "setItem">) {
  const key = "storybook.mcp-window.v1"
  let initialState: NonNullable<WebMcpWindow.Input["initialState"]> | undefined
  try {
    const value = JSON.parse(storage().getItem(key) ?? "null")
    if (value && typeof value === "object" && !Array.isArray(value)) initialState = value as NonNullable<WebMcpWindow.Input["initialState"]>
  } catch {}
  return {
    initialState,
    save(state: WebMcpWindow.Output): void {
      try { storage().setItem(key, JSON.stringify(state)) } catch {}
    },
  }
}
