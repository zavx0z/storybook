/**
Проверка точного адреса из публичной структуры Storybook.

@property address - Публичный адрес без начального/конечного слеша, query и fragment.
Слеш разделяет уровни, точка внутри имени сохраняется буквально.

@property paths - Адреса публичных владельцев и категорий действующего каталога.
Частные файлы и параметры интерфейса не становятся адресами.
*/
export interface ResolveMcpAddressInput {
  readonly address: string
  readonly paths: readonly string[]
}
