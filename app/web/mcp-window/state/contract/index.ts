export declare namespace McpWindowState {
  /** Сохраняемые настройки окна; ответы MCP и история обращений сюда не входят. */
  export interface Output {
    open: boolean
    mode: "agent" | "address"
    geometry: {x: number, y: number, width: number, height: number}
  }
}
