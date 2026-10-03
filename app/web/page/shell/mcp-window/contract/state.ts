/** Частичные поля сохранённого окна, включая прежнее сворачивание. */
export type McpWindowInitialState = Readonly<{
  open?: boolean
  mode?: "agent" | "address"
  geometry?: Partial<Readonly<{x: number, y: number, width: number, height: number}>>
  minimized?: boolean
}>
