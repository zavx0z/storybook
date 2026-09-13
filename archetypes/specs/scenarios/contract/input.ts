/**
Вход чтения исполняемого сценария.

@property path - Путь к файлу Bun Test. Относительный путь разрешается от cwd вызывающего процесса.
Импорты и настройки запуска определяются по сценарию и его пакету.

@property [env] - Переменные окружения отдельного дочернего запуска.

@property [testNamePattern] - Штатный фильтр имён групп и тестов Bun.
*/
export interface ReadScenarioInput {
  readonly path: string
  readonly env?: Readonly<Record<string, string>>
  readonly testNamePattern?: string
}
