import type {ReadScenarioOutput} from "@archetypes/specs/scenarios"

/** Подготовленный источник одной ревизии; отсутствие файла и отсутствие результата различаются. */
export interface ScenariosInput {
  readonly owner: {readonly kind: "repository" | "entity" | "package", readonly path: string}
  readonly source: string | null
  readonly prepared: {readonly revision: string, readonly result: ReadScenarioOutput} | null
}
