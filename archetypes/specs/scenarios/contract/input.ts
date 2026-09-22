/**
Вход чтения исполняемого сценария.

@property path - Путь к файлу Bun Test. Относительный путь разрешается от cwd вызывающего процесса.
Импорты и настройки запуска определяются по сценарию и его пакету.

@property [props] - Поля, заменяемые по имени в props каждой строки внешнего describe.each.
Остальные поля строки и props сохраняются; вложенное значение заменяется целиком.
Поддерживаются JSON-данные: null, строки, boolean, конечные числа кроме -0,
массивы без пропусков и обычные объекты без вычисляемых свойств и циклов.
Без props используются исходные варианты. Вложенные describe.each и test.each не изменяются.

@property [testNamePattern] - Штатный фильтр имён групп и тестов Bun.
*/
export interface ReadScenarioInput {
  readonly path: string
  readonly props?: Readonly<Record<string, unknown>>
  readonly testNamePattern?: string
}
