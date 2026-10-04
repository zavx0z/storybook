import type {Zavx0zStorybookSpecsScenariosReader} from "@zavx0z/storybook-specs-scenarios-reader"

export declare namespace Zavx0zStorybookSpecsReader {
  /**
  Вход чтения спецификации.

  @property path - Директория непосредственного владельца спецификации.
  */
  export interface Input {
    readonly path: string
  }


  /**
  Прочитанная спецификация либо `null`, если директория `spec` отсутствует.

  @property scenario - Результат запуска сценария {@link Zavx0zStorybookSpecsScenariosReader.Output}
  либо `null`, если в спецификации нет файла сценария.
  */
  export type Output = {
    readonly scenario: Zavx0zStorybookSpecsScenariosReader.Output | null
  } | null
}
