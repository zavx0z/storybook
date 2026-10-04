import type {StorybookAppWebPageShellMcpWindow} from "@storybook-app-web-page-shell/mcp-window"

/**
Хранит настройки окна в localStorage текущего origin. Проверка полей и
начальные значения принадлежат самому окну; недоступное хранилище не мешает ему.
*/
export function createMcpWindowPersistence(storage: () => Pick<Storage, "getItem" | "setItem">) {
  const key = "storybook.mcp-window.v1"
  let initialState: NonNullable<StorybookAppWebPageShellMcpWindow.Input["initialState"]> | undefined
  try {
    const value = JSON.parse(storage().getItem(key) ?? "null")
    if (value && typeof value === "object" && !Array.isArray(value)) initialState = value as NonNullable<StorybookAppWebPageShellMcpWindow.Input["initialState"]>
  } catch {}
  return {
    initialState,
    save(state: StorybookAppWebPageShellMcpWindow.Output): void {
      try { storage().setItem(key, JSON.stringify(state)) } catch {}
    },
  }
}
