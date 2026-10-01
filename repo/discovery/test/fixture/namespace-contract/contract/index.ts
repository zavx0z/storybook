/** Три направления контракта одного публичного Component. */
export declare namespace DiscoveryFixtureNamespaceContract {
  /**
  Вход сохраняет вложенную конфигурацию для отображения дерева и JSON Schema.

  @property source - Имя источника для чтения.
  @property options - Ограничения обработки входа.
  */
  type Input = Readonly<{
    source: string
    options: Readonly<{limit: number; enabled?: boolean}>
  }>

  /**
  Результат сохраняет найденные значения и признак завершения.

  @property values - Прочитанные значения в исходном порядке.
  @property complete - Обработка достигла конца источника.
  */
  type Output = Readonly<{
    values: readonly string[]
    complete: boolean
  }>

  /**
  Точки вставки авторской композиции.

  @property default - Основное содержимое.
  @property [header] - Необязательный заголовок.
  */
  type Slots = Readonly<{
    default: string
    header?: string
  }>
}
