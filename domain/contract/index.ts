import type {ArchetypesPackage} from "@archetypes/package"

export declare namespace ArchetypesDomain {
  /**
  Директория проверяемого пакета; класс не передаётся вызывающим кодом.

  @property path - Физический корень пакета.
  */
  export interface Input {
    readonly path: string
  }

  /**
  Структурные свидетельства предметной области из её состава и публичного кода.

  @property package - Общий состав пакета и источники его документации.
  @property localCode - Исполняемые публичные входы, реализация которых принадлежит самому домену.
  @property undeclaredOwners - Вложенные владельцы публичных входов, отсутствующие в составе workspaces.
  @property scenarios - Необязательные непосредственные сценарии правил области.
  Пустой список не является нарушением и не препятствует классификации Domain.
  */
  export interface Output {
    readonly package: ArchetypesPackage.Output
    readonly localCode: readonly string[]
    readonly undeclaredOwners: readonly string[]
    readonly scenarios: readonly string[]
  }
}
