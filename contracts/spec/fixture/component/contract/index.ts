/** Формы взаимодействия самостоятельного владельца примера. */
export declare namespace StorybookContractsSpecFixtureComponent {
  /**
  Параметры одного увеличения значения.

  @property value - Исходное значение перед увеличением.

  @property [step=1] - Добавляемый шаг; отсутствие выбирает единичное увеличение.
  */
  type Input = {
    readonly value: number
    readonly step?: number
  }
  /**
  Значение после прибавления выбранного шага.
  */
  type Output = number
}
