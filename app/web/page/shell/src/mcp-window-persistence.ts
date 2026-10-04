import type {Zavx0zStorybookAppWebPageShellMcpWindow} from "@zavx0z/storybook-app-web-page-shell-mcp-window"

/**
Хранит настройки окна в localStorage текущего origin. Проверка полей и
начальные значения принадлежат самому окну; недоступное хранилище не мешает ему.
*/
export function createMcpWindowPersistence(storage: () => Pick<Storage, "getItem" | "setItem">) {
  const key = "storybook.mcp-window.v1"
  let initialState: NonNullable<Zavx0zStorybookAppWebPageShellMcpWindow.Input["initialState"]> | undefined
  try {
    const value = JSON.parse(storage().getItem(key) ?? "null")
    if (value && typeof value === "object" && !Array.isArray(value)) initialState = value as NonNullable<Zavx0zStorybookAppWebPageShellMcpWindow.Input["initialState"]>
  } catch {}
  return {
    initialState,
    save(state: Zavx0zStorybookAppWebPageShellMcpWindow.Output): void {
      try { storage().setItem(key, JSON.stringify(state)) } catch {}
    },
  }
}
