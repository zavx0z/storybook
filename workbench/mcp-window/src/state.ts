/** Сохраняемые настройки окна; ответы MCP и история обращений сюда не входят. */
export interface McpWindowState {
  open: boolean
  mode: "agent" | "address"
  minimized: boolean
  geometry: {x: number, y: number, width: number, height: number}
}

/** Начальное закрытое окно до первого сохранения пользовательских настроек. */
export function defaultMcpWindowState(): McpWindowState {
  return {open: false, mode: "agent", minimized: false, geometry: {x: 24, y: 24, width: 620, height: 400}}
}

/**
Хранит настройки в localStorage текущего origin. Повреждённые поля получают
начальные значения; недоступное хранилище не мешает работе окна.
*/
export function createMcpWindowPersistence(storage: () => Pick<Storage, "getItem" | "setItem">) {
  const key = "storybook.mcp-window.v1"
  const initialState = defaultMcpWindowState()
  try {
    const value = JSON.parse(storage().getItem(key) ?? "null")
    if (value && typeof value === "object") {
      if (typeof value.open === "boolean") initialState.open = value.open
      if (value.mode === "agent" || value.mode === "address") initialState.mode = value.mode
      if (typeof value.minimized === "boolean") initialState.minimized = value.minimized
      for (const field of ["x", "y", "width", "height"] as const) {
        const number = value.geometry?.[field]
        const minimum = field === "width" ? 320 : field === "height" ? 200 : 0
        if (typeof number === "number" && Number.isFinite(number)) initialState.geometry[field] = Math.max(minimum, number)
      }
    }
  } catch {}
  return {
    initialState,
    save(state: McpWindowState): void {
      try { storage().setItem(key, JSON.stringify(state)) } catch {}
    },
  }
}
