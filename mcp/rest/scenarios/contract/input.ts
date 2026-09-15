import type {ReadSpecOutput} from "@archetypes/specs"

/** Исходный сценарий выбранного владельца и необязательный выбор ветки ответа. */
export interface ReadScenariosInput {
  readonly path: string
  /** Ожидаемый исходный файл для проверки принадлежности старых потребителей. */
  readonly source?: string
  /** Уже выполненный публичный результат спецификации применённой ревизии. */
  readonly prepared?: {
    readonly revision: string
    readonly result: ReadSpecOutput
  }
  readonly format?: "document" | "data"
  readonly selection?: {
    readonly variant?: string
    readonly section?: readonly string[]
  }
}
