/** Исходный сценарий выбранного владельца и необязательный выбор ветки ответа. */
export interface ReadScenariosInput {
  readonly path: string
  readonly source: string
  readonly format?: "document" | "data"
  readonly selection?: {
    readonly variant?: string
    readonly section?: readonly string[]
  }
}
