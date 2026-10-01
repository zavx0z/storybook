import type {ArchetypesScenarioReader} from "@archetypes/scenario-reader"

export declare namespace ArchetypesSpecReader {
  /**
  Вход чтения спецификации.

  @property path - Директория непосредственного владельца спецификации.
  */
  export interface Input {
    readonly path: string
  }


  /**
  Прочитанная спецификация либо `null`, если директория `spec` отсутствует.

  @property scenario - Результат запуска сценария {@link ArchetypesScenarioReader.Output}
  либо `null`, если в спецификации нет файла сценария.
  */
  export type Output = {
    readonly scenario: ArchetypesScenarioReader.Output | null
  } | null
}
