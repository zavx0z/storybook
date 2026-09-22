import type {ReadScenarioInput, ScenarioPreview} from "@archetypes/specs/scenarios"
import type {CompiledTemplate} from "@zavx0z/template/compiled"

/** Только компонент содержит template; host запускает тест перед показом выбранного варианта. */
export type ScenarioAppInput = (
  | {
    readonly kind: "component"
    readonly template: CompiledTemplate<Record<string, unknown>>
    readonly variants: Extract<ScenarioPreview, {kind: "component"}>["variants"]
  }
  | {
    readonly kind: "function"
    readonly variants: Extract<ScenarioPreview, {kind: "function"}>["variants"]
  }
) & {
    readonly run?: (
      variant: ScenarioPreview["variants"][number],
      signal: AbortSignal,
      onProgress: NonNullable<ReadScenarioInput["onProgress"]>,
    ) => Promise<{
      source: string
      props?: Readonly<Record<string, unknown>>
      calls: Extract<ScenarioPreview, {kind: "function"}>["variants"][number]["calls"]
      points: Extract<ScenarioPreview, {kind: "function"}>["variants"][number]["points"]
      execution: {
        status: "passed" | "failed"
        message?: string
        tests: readonly {label: string, status: string, message: string | null}[]
      }
    }>
  }
