/**
Владелец спецификации, по которой нужно показать руководство.

@property path - Директория непосредственного владельца spec.
Поиск не переходит к родителю или вложенным владельцам.
*/
export interface ReadSpecGuideInput {
  readonly path: string
}
