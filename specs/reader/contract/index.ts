import type {StorybookSpecsScenariosReader} from "@storybook-specs-scenarios/reader"

export declare namespace StorybookSpecsReader {
  /**
  Вход чтения спецификации.

  @property path - Директория непосредственного владельца спецификации.
  */
  export interface Input {
    readonly path: string
  }


  /**
  Прочитанная спецификация либо `null`, если директория `spec` отсутствует.

  @property scenario - Результат запуска сценария {@link StorybookSpecsScenariosReader.Output}
  либо `null`, если в спецификации нет файла сценария.
  */
  export type Output = {
    readonly scenario: StorybookSpecsScenariosReader.Output | null
  } | null
}
