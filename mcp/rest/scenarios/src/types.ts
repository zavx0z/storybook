import type {ReadScenarioOutput} from "@archetypes/specs/scenarios"

/** Подготовленный источник одной ревизии; отсутствие файла и отсутствие результата различаются. */
export interface ScenariosInput {
  readonly owner: {readonly kind: "repository" | "entity" | "package", readonly path: string}
  readonly source: string | null
  readonly prepared: {readonly revision: string, readonly result: ReadScenarioOutput} | null
}

/** Выбор дерева либо его темы; имена берутся из самого сценария. */
export interface ScenariosTreeOptions {
  readonly format: "tree"
  readonly variant?: string
  readonly section?: readonly string[]
}


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

interface ScenarioTreeAssertion {
  readonly customFailMessage?: string
  readonly actual: ReadScenarioOutput["assertions"][number]["actual"]
  readonly matcher: string
  readonly expected: ReadScenarioOutput["assertions"][number]["expected"]
  readonly status: "passed" | "failed"
  readonly modifiers?: readonly string[]
  readonly error?: ReadScenarioOutput["assertions"][number]["error"]
}

interface ScenarioTreeItem {
  readonly label: string
  readonly status: ReadScenarioOutput["tests"][number]["status"]
  readonly assertions?: readonly ScenarioTreeAssertion[]
  readonly unexecuted?: readonly {readonly customFailMessage: string | null}[]
  readonly message?: string
  readonly skipReason?: string
}

interface ScenarioTreeGroup {
  readonly label: string
  readonly parameters?: ReadScenarioOutput["groups"][number]["parameters"]
  readonly children?: readonly ScenarioTreeGroup[]
  readonly items?: readonly ScenarioTreeItem[]
}

/** Структура и содержание в одном дереве; пустые структурные списки отсутствуют, значения actual сохраняются. */
export interface ScenariosTree {
  readonly status: ScenariosOutput["status"]
  readonly variants?: readonly ScenarioTreeGroup[]
  readonly items?: readonly ScenarioTreeItem[]
}
