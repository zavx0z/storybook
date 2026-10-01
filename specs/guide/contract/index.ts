import type {ArchetypesScenarioGuide} from "@archetypes/scenario-guide"

/** Форма запроса и результата руководства спецификации. */
export declare namespace SpecsGuide {
  /** Непосредственный владелец спецификации; поиск не переходит к родителю. */
  export interface Input {
    readonly path: string
  }

  /** Руководство либо null при отсутствии сценария у владельца. */
  export type Output = ArchetypesScenarioGuide.Output | null
}
