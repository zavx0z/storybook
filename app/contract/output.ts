import type {ScenarioAppInput} from "./input"

/** Общий выбор для Editor и Display; повторный выбор не пересоздаёт представление. */
export interface ScenarioApp {
  readonly kind: ScenarioAppInput["kind"]
  readonly variants: ScenarioAppInput["variants"]
  getSnapshot(): ScenarioAppInput["variants"][number]
  subscribe(listener: () => void): () => void
  select(id: string): void
}
