import type {ReadPackageOutput} from "@archetypes/package"

/**
Структурные свидетельства предметной области из её состава и публичного кода.

@property package - Общий состав пакета и источники его документации.
@property localCode - Исполняемые публичные входы, реализация которых принадлежит самому домену.
@property undeclaredOwners - Вложенные владельцы публичных входов, отсутствующие в составе workspaces.
@property scenarios - Необязательные непосредственные сценарии правил области.
Пустой список не является нарушением и не препятствует классификации Domain.
*/
export interface ReadDomainOutput {
  readonly package: ReadPackageOutput
  readonly localCode: readonly string[]
  readonly undeclaredOwners: readonly string[]
  readonly scenarios: readonly string[]
}
