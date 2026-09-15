import type {ScenarioPreview} from "@archetypes/specs/scenarios"
import type {CompiledTemplate} from "@zavx0z/template/compiled"

/** Только компонент содержит исполняемый template; функция передаёт сохранённые данные. */
export type ScenarioAppInput =
  | {
    readonly kind: "component"
    readonly template: CompiledTemplate<Record<string, unknown>>
    readonly variants: Extract<ScenarioPreview, {kind: "component"}>["variants"]
  }
  | {
    readonly kind: "function"
    readonly variants: Extract<ScenarioPreview, {kind: "function"}>["variants"]
  }
