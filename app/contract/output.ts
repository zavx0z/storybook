import type {ScenarioAppInput} from "./input"
import type {ReadScenarioInput} from "@archetypes/specs/scenarios"

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
      readonly progress?: {
        readonly phase: Parameters<NonNullable<ReadScenarioInput["onProgress"]>>[0]["phase"]
        readonly output: string
      }
      readonly tests?: readonly {label: string, status: string, message: string | null}[]
    }
  }
  subscribe(listener: () => void): () => void
  select(id: string): void
  dispose(): void
}
