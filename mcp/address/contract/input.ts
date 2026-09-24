/**
Проверка точного адреса пакета из общего каталога Storybook.

@property address - Публичный адрес без начального/конечного слеша, query и fragment.
Слеш разделяет уровни, точка внутри имени сохраняется буквально.

@property packages - Адреса только пакетных узлов действующего canonical graph.
Файловые директории и разделы документации в этот список не включаются.
*/
export interface ResolveMcpAddressInput {
  readonly address: string
  readonly packages: readonly string[]
}
