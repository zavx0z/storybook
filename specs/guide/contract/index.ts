import type {Zavx0zStorybookSpecsScenarios} from "@zavx0z/storybook-specs-scenarios"

/** Форма запроса и результата руководства спецификации. */
export declare namespace Zavx0zStorybookSpecsGuide {
  /** Непосредственный владелец спецификации; поиск не переходит к родителю. */
  export interface Input {
    readonly path: string
  }

  /** Руководство либо null при отсутствии сценария у владельца. */
  export type Output = Zavx0zStorybookSpecsScenarios.Output | null
}
