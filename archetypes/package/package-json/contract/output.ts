/**
Данные пакета, используемые для описания его публичного состава.

@property name - Идентификатор пакета из манифеста.

@property [label] - Необязательное отображаемое название пакета.

@property description - Краткое описание назначения; пустая строка при отсутствии.

@property exports - Карта публичных экспортов; короткая строковая форма нормализована в `.`.
Отсутствующий exports даёт пустую карту: Repo и Domain не обязаны иметь исполняемый вход.

@property [workspaces] - Корневое объявление состава Repo для штатного читателя workspaces.
*/
export interface ReadPackageJsonOutput {
  readonly name: string
  readonly label?: string
  readonly description: string
  readonly exports: Readonly<Record<string, unknown>>
  readonly workspaces?: readonly string[] | {readonly packages: readonly string[]}
}
