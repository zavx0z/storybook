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

@property [variant] - Индекс строки единственного внешнего describe.each, начиная с нуля.
При выборе регистрируется только эта строка, включая её подготовку и проверки.

@property [signal] - Отмена запуска; дочерний процесс завершается при отмене.

@property [onProgress] - Этапы и фрагменты stdout/stderr до готовности полного отчёта.
Вывод отражает ход выполнения; итоговые статусы проверок принадлежат результату Bun.
Исключение наблюдателя не изменяет выполнение теста.
*/
export interface ReadScenarioInput {
  readonly path: string
  readonly props?: Readonly<Record<string, unknown>>
  readonly testNamePattern?: string
  readonly variant?: number
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: {
    phase: "queued" | "preparing" | "running" | "reporting"
    text?: string
    stream?: "stdout" | "stderr"
  }) => void
}
