import type {ScenarioAppInput} from "./input"

/**
Общий выбор для Editor и Display; повторный выбор текущего варианта не пересоздаёт представление.
Снимок функции содержит состояние нового запуска, затем его исходы и проверки.
dispose отменяет запрос и освобождает подписки при уходе со страницы.
*/
export interface ScenarioApp {
  readonly kind: ScenarioAppInput["kind"]
  readonly variants: ScenarioAppInput["variants"]
  getSnapshot(): ScenarioAppInput["variants"][number] & {
    readonly execution?: {
      readonly status: "running" | "passed" | "failed"
      readonly message?: string
      readonly tests?: readonly {label: string, status: string, message: string | null}[]
    }
  }
  subscribe(listener: () => void): () => void
  select(id: string): void
  dispose(): void
}
