/** Формы взаимодействия самостоятельного владельца примера. */
export declare namespace StorybookContractsSpecFixtureContainerPart {
  /**
  Данные самостоятельного вклада части.

  @property value - Значение, которое часть передаёт целому.
  */
  type Input = {readonly value: number}
  /**
  Результат части с необязательной подписью.

  @property value - Подготовленное значение вклада.

  @property [label] - Пояснение для потребителя, если оно задано.
  */
  type Output = {readonly value: number, readonly label?: string}
}
