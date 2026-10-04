import type {Zavx0zStorybookPackageReader} from "@zavx0z/storybook-package-reader"
import type {Zavx0zStorybookContracts} from "@zavx0z/storybook-contracts"

export declare namespace Zavx0zStorybookDomain {
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
    readonly package: Zavx0zStorybookPackageReader.Output
    readonly protocols: Zavx0zStorybookContracts.Output
    readonly sharedDefinitions: readonly Zavx0zStorybookContracts.Output["entries"][number]["namespaces"][number]["roles"][number]["dependencies"][number][]
    readonly scenarios: readonly string[]
  }
}
