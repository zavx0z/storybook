import type {ReadScenarioOutput} from "@archetypes/specs/scenarios"
import type {ScenariosInput} from "./input"

interface ScenarioItem {
  readonly id: number
  readonly groupId: number | null
  readonly label: string
  readonly status: ReadScenarioOutput["tests"][number]["status"]
  readonly message: string | null
  readonly skipReason: string | null
  readonly assertions: ReadScenarioOutput["assertions"]
  readonly unexecuted: ReadScenarioOutput["tests"][number]["assertions"]
}

interface ScenarioCategory {
  readonly id: number
  readonly label: string
  readonly parameters: ReadScenarioOutput["groups"][number]["parameters"]
  readonly categories: readonly ScenarioCategory[]
  readonly items: readonly ScenarioItem[]
}

/** Каталог одной ревизии поверх полного отчёта, без повторного исполнения сценария. */
export interface ScenariosOutput {
  readonly owner: ScenariosInput["owner"]
  readonly source: string | null
  readonly status: "absent" | "pending" | "ready"
  readonly revision: string | null
  readonly variants: readonly ScenarioCategory[]
  readonly items: readonly ScenarioItem[]
}
