import type {StorybookPackageReader} from "@storybook-package/reader"
import type {StorybookContracts} from "@storybook/contracts"

export declare namespace StorybookDomain {
  /**
  Директория проверяемого пакета; класс не передаётся вызывающим кодом.

  @property path - Физический корень пакета.
  */
  export interface Input {
    readonly path: string
  }

  /**
  Средовые входы одной сущности и происхождение связывающих их определений.

  @property package - Общий состав пакета и источники его документации.
  @property protocols - Протоколы публичных входов, условия выбора и диагностика их чтения.
  @property sharedDefinitions - Исходные определения, использованные протоколами всех основных входов. Их наличие не заменяет проверку общих правил поведением.
  @property scenarios - Непосредственные сценарии предметных правил и средовых реализаций.
  */
  export interface Output {
    readonly package: StorybookPackageReader.Output
    readonly protocols: StorybookContracts.Output
    readonly sharedDefinitions: readonly StorybookContracts.Output["entries"][number]["namespaces"][number]["roles"][number]["dependencies"][number][]
    readonly scenarios: readonly string[]
  }
}
