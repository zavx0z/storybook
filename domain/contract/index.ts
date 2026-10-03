import type {ArchetypesPackage} from "@archetypes/package"
import type {ArchetypesContracts} from "@archetypes/contracts"

export declare namespace ArchetypesDomain {
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
    readonly package: ArchetypesPackage.Output
    readonly protocols: ArchetypesContracts.Output
    readonly sharedDefinitions: readonly ArchetypesContracts.Output["entries"][number]["namespaces"][number]["roles"][number]["dependencies"][number][]
    readonly scenarios: readonly string[]
  }
}
