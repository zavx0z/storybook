/**
Вход чтения исполняемого сценария.

@property path - Путь к файлу Bun Test. Относительный путь разрешается от cwd вызывающего процесса.
Импорты и настройки запуска определяются по сценарию и его пакету.
*/
export interface ReadScenarioInput {
  readonly path: string
}
