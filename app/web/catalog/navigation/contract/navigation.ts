/** Структурный узел каталога с адресом перехода, определённым принимающей стороной. */
export type Item = Readonly<{
  id: string
  label: string
  route: string
  title?: string
  disabled?: boolean
  expandable?: boolean
  searchText?: string
  group?: Group
  parentId?: string
}>

/** Группа раскрытия; item связывает выбираемую ветвь с её узлом каталога. */
export type Group = Readonly<{
  id: string
  label: string
  item?: Item
}>
