import type {StorybookSpecsScenarios} from "@zavx0z/storybook-specs-scenarios"

/** Форма запроса и результата руководства спецификации. */
export declare namespace StorybookSpecsGuide {
  /** Непосредственный владелец спецификации; поиск не переходит к родителю. */
  export interface Input {
    readonly path: string
  }

  /** Руководство либо null при отсутствии сценария у владельца. */
  export type Output = StorybookSpecsScenarios.Output | null
}
