import type {ScenarioPreview} from "@archetypes/specs/scenarios"
import type {CompiledTemplate} from "@zavx0z/template/compiled"

/** Подготовленные варианты и исполняемая общая фикстура из той же ревизии пакета. */
export interface ScenarioAppInput {
  readonly template: CompiledTemplate<Record<string, unknown>>
  readonly variants: ScenarioPreview["variants"]
}
