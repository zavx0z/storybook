/**
Авторский обзор выбранного пакета.

@property content - Неизменённый Markdown; null означает отсутствие обычного файла.
Пустая строка означает существующий пустой README, а не ошибку чтения.
*/
export interface ReadPackageReadmeOutput {
  readonly content: string | null
}
