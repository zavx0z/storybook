/**
Точное исходное объявление; реэкспорт не изменяет его принадлежность.

@property owner - Ближайший пакет исходного объявления, если он установлен.
@property contract - Собственное объявление расположено в contract своего владельца.
*/
export interface Declaration {
  readonly name: string
  readonly path: string
  readonly line: number
  readonly owner: {readonly name: string, readonly path: string} | null
  readonly contract: boolean
}

/** Поле разрешённой формы с native TypeScript типом и исходными объявлениями. */
export interface Field {
  readonly name: string
  readonly type: string
  readonly optional: boolean
  readonly declarations: readonly Declaration[]
}

/**
Роль внутри типового namespace; имена файлов не назначают роль.

@property name - Применимое направление публичного соглашения.
@property dependencies - Объявления, из которых составлена роль, включая вложенные собственные типы.
*/
export interface Role {
  readonly name: "Input" | "Output" | "Slots"
  readonly type: string
  readonly fields: readonly Field[]
  readonly declarations: readonly Declaration[]
  readonly dependencies: readonly Declaration[]
}

/**
Публичное имя namespace и исходный владелец его типовых определений.

@property slotsLinked - Совпадение Slots и типового параметра JSX-результата;
null, если одна из этих ролей отсутствует. Это факт TypeScript, не проверка исполнения JSX.
*/
export interface Namespace {
  readonly name: string
  readonly declaration: Declaration
  readonly roles: readonly Role[]
  readonly slotsLinked: boolean | null
}

/**
Диагностика формы или принадлежности; смысловая полнота поведения отдельно не утверждается.

@property severity - Несовпадение имени namespace с именем пакета является предупреждением;
нарушения формы и принадлежности являются ошибками.
*/
export interface Diagnostic {
  readonly severity: "warning" | "error"
  readonly code: string
  readonly path: string
  readonly message: string
}

/** Связь собственного протокола участника с общим протоколом его группы. */
export interface Extension {
  readonly base: Declaration
  readonly member: Declaration
  readonly roles: readonly {
    readonly name: Role["name"]
    /** Участник ссылается на исходную роль общего протокола, а не копирует её поля. */
    readonly linked: boolean
    /** Native TypeScript подтверждает расширение содержательной типовой формы. */
    readonly compatible: boolean
  }[]
}
