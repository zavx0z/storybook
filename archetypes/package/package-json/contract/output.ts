/**
Данные пакета, используемые для описания его публичного состава.

@property name - Идентификатор пакета из манифеста.

@property label - Отображаемое название пакета.

@property description - Краткое описание назначения пакета.

@property exports - Карта публичных экспортов без преобразования её значений.
*/
export interface ReadPackageJsonOutput {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly exports: Readonly<Record<string, unknown>>
}
