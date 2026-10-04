import type {JSX} from "@immersive/jsx"

/** Формы взаимодействия самостоятельного владельца примера. */
export declare namespace ContractFixturePart {
  /**
  Содержимое вложенной части рабочей области.

  @property text - Текст, показываемый частью внутри композиции.
  */
  type Input = {readonly text: string}
  /**
  JSX-элемент вложенной части без собственного контракта слотов.
  */
  type Output = JSX.Element
}
