import type {ReadPackageOutput} from "@archetypes/package"

/**
Структурные свидетельства предметной области; смысл её правил раскрывается собственными сценариями.

@property package - Общий состав пакета и источники его документации.
@property localCode - Исполняемые публичные входы, реализация которых принадлежит самому домену.
@property undeclaredOwners - Вложенные владельцы публичных входов, отсутствующие в составе workspaces.
@property scenarios - Непосредственные сценарии правил области.
*/
export interface ReadDomainOutput {
  readonly package: ReadPackageOutput
  readonly localCode: readonly string[]
  readonly undeclaredOwners: readonly string[]
  readonly scenarios: readonly string[]
}
