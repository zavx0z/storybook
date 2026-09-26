/**
Условия чтения и выполнения сценария средствами Bun Test.

@property path - Путь к файлу сценария. Относительный путь разрешается от рабочего
каталога вызывающего процесса. Импорты и настройки запуска определяются
по сценарию и его пакету.

@property [props] - Поля, заменяемые по имени в `props` каждой строки внешнего
`describe.each`. Остальные поля строки и `props` сохраняются; вложенное значение
заменяется целиком. Поддерживаются JSON-данные: `null`, строки, логические значения,
конечные числа кроме `-0`, массивы без пропусков и обычные объекты без вычисляемых
свойств и циклов. Без `props` используются исходные варианты.
Вложенные `describe.each` и `test.each` не изменяются.

@property [testNamePattern] - Штатный фильтр имён групп и тестов Bun.

@property [variant] - Индекс строки единственного внешнего `describe.each`,
начиная с нуля. Регистрируется только эта строка, включая её подготовку и проверки.

@property [signal] - Сигнал отмены запуска; при отмене дочерний процесс завершается.

@property [onProgress] - Обработчик этапов и фрагментов стандартного и диагностического
вывода до готовности полного отчёта. `phase` обозначает этап, `text` — фрагмент,
`stream` — поток `stdout` или `stderr`. Итоговые статусы проверок берутся
из результата Bun. Исключение обработчика не изменяет выполнение теста.
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
