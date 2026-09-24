/**
Текущий контекст и навигационная проекция единственного каталога.

@property [path] - Адрес выбранного направления. Отсутствие означает корневой вход.

@property [label] - Дополнительное авторское название, если оно помогает ориентироваться.

@property description - Его назначение; пустое описание не заменяется вымышленным.

@property entries - Доступные адреса в порядке каталога. parent указывает адрес
непосредственного родителя; null обозначает верхний уровень. path, label и
description принадлежат самому владельцу, независимо от типа его содержимого.
*/
export interface ReadMcpChildrenInput {
  readonly path?: string
  readonly label?: string
  readonly description: string
  readonly entries: readonly {
    readonly path: string
    readonly label?: string
    readonly description: string
    readonly parent: string | null
  }[]
}
