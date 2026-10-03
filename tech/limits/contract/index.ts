/** Общие конечные бюджеты технологического исполнения на поддерживаемом Intel host. */
export declare namespace TechLimits {
  /**
  Продолжительности сохраняют единицы вызывающих API.
  @property STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS - Бюджет одной пакетной компиляции, миллисекунды.
  @property STORYBOOK_SCENARIO_TIMEOUT_MS - Подготовка JSX и исполнение сценария, миллисекунды; не меняет собственные таймауты Bun Test.
  @property STORYBOOK_SHARED_COMPILE_TIMEOUT_MS - Бюджет подготовки общей среды, миллисекунды.
  @property STORYBOOK_SERVER_START_TIMEOUT_MS - Бюджет готовности запущенного процесса, миллисекунды.
  @property STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS - Время удержания HTTP-запроса, секунды.
  */
  type Output = Readonly<{
    STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS: number
    STORYBOOK_SCENARIO_TIMEOUT_MS: number
    STORYBOOK_SHARED_COMPILE_TIMEOUT_MS: number
    STORYBOOK_SERVER_START_TIMEOUT_MS: number
    STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS: number
  }>
}
