import type {ContractFixturePart} from "../part/index"

/** Формы взаимодействия самостоятельного владельца примера. */
export declare namespace ContractFixtureCombined {
  /**
  Результаты частей, передаваемые общей композиции.

  @property left - Результат первой части, сохраняющий её типовой контракт.

  @property right - Результат второй части; целое получает уже подготовленные данные.
  */
  type Input = {readonly left: ContractFixturePart.Output, readonly right: ContractFixturePart.Output}
  /**
  Результат объединения вкладов частей.

  @property total - Сумма значений результатов обеих частей.
  */
  type Output = {readonly total: number}
}
