import type {StorybookSpecsDocument} from "@zavx0z/storybook-specs-document"

/** Форма запроса и результата руководства по исполняемому сценарию. */
export declare namespace StorybookSpecsScenarios {
  /** Путь к непосредственному сценарию владельца. */
  export interface Input {
    readonly path: string
  }

  /** Документ с файлами, кодовыми примерами и состоянием проверок. */
  export type Output = StorybookSpecsDocument.Output
}
