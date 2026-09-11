/**
Файловый вход одной сборки общей оболочки.

@property root - Каталог сохранения immutable hashed assets.

@property toolRoot - Канонический checkout владельца компилятора и оболочки.

@property landingEntryPath - Исходник главной страницы.

@property fallbackEntryPath - Исходник страницы до применения пакетной ревизии.

@property stagingDirectory - Изолированный каталог только текущей операции.
*/
export interface SharedBrowserBuildInput {
  readonly root: string
  readonly toolRoot: string
  readonly landingEntryPath: string
  readonly fallbackEntryPath: string
  readonly packageEntryPath?: string
  readonly stagingDirectory: string
}
