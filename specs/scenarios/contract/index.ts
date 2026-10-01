import type {ArchetypesScenarioDocument} from "@archetypes/scenario-document"

/** Форма запроса и результата руководства по исполняемому сценарию. */
export declare namespace ArchetypesScenarioGuide {
  /** Путь к непосредственному сценарию владельца. */
  export interface Input {
    readonly path: string
  }

  /** Документ с файлами, кодовыми примерами и состоянием проверок. */
  export type Output = ArchetypesScenarioDocument.Output
}
