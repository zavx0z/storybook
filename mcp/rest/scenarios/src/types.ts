import type {ReadScenarioOutput} from "@archetypes/specs/scenarios"

/** Подготовленный источник одной ревизии; отсутствие файла и отсутствие результата различаются. */
export interface ScenariosInput {
  readonly owner: {readonly kind: "repository" | "entity" | "package", readonly path: string}
  readonly source: string | null
  readonly prepared: {readonly revision: string, readonly result: ReadScenarioOutput} | null
}

/** Выбор дерева либо его темы; имена берутся из самого сценария. */
export interface ScenariosDocumentOptions {
  readonly format: "document"
  readonly variant?: string
  readonly section?: readonly string[]
}


interface ScenarioItem {
  readonly id: number
  readonly groupId: number | null
  readonly label: string
  readonly location: ReadScenarioOutput["tests"][number]["location"]
  readonly status: ReadScenarioOutput["tests"][number]["status"]
  readonly message: string | null
  readonly skipReason: string | null
  readonly assertions: ReadScenarioOutput["assertions"]
  readonly unexecuted: ReadScenarioOutput["tests"][number]["assertions"]
}

interface ScenarioCategory {
  readonly id: number
  readonly label: string
  readonly location: ReadScenarioOutput["groups"][number]["location"]
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
  readonly validation: ReadScenarioOutput["validation"] | null
  readonly variants: readonly ScenarioCategory[]
  readonly items: readonly ScenarioItem[]
  readonly preview?: ReadScenarioOutput["preview"]
}

/** Абзац документа с пояснением и предметным значением или примером. */
export interface ScenarioContent {
  readonly text?: string
  readonly value?: ReadScenarioOutput["assertions"][number]["actual"]
    | Extract<NonNullable<ReadScenarioOutput["preview"]>, {kind: "component"}>["variants"][number]["props"]
    | NonNullable<ReadScenarioOutput["preview"]>["variants"][number]["points"]
}

/** Раздел документа; вложенность и порядок следуют исходному сценарию. */
export interface ScenarioSection {
  readonly title: string
  readonly content?: readonly ScenarioContent[]
  readonly sections?: readonly ScenarioSection[]
  readonly notes?: readonly string[]
}

/** Документ для чтения: пояснения, примеры, предметные данные и вложенные разделы. */
export interface ScenariosDocument {
  readonly sections?: readonly ScenarioSection[]
  readonly notes?: readonly string[]
}
