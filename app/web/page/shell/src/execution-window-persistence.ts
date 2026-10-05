import type {StorybookAppWebPageShellExecutionSettings as Contract} from "@zavx0z/storybook-app-web-page-shell-execution-settings"

/** Приложение сохраняет только положение окна и Tab, без провайдерских данных. */
export function createExecutionWindowPersistence(storage: () => Pick<Storage, "getItem" | "setItem">) {
  const key = "storybook.execution-window.v1"
  let initialState: Contract.Input["initialState"]
  try {
    const value = JSON.parse(storage().getItem(key) ?? "null")
    if (value && typeof value === "object" && !Array.isArray(value)) initialState = value
  } catch {}
  return {initialState, save(state: Parameters<NonNullable<Contract.Input["onStateChange"]>>[0]) {
    try {storage().setItem(key, JSON.stringify(state))} catch {}
  }}
}
