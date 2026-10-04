import type {JSX} from "@zavx0z/immersive-jsx"
import type {StorybookContractsSpecFixtureJsxContainerPart} from "../part/index"

/** Формы взаимодействия самостоятельного владельца примера. */
export declare namespace StorybookContractsSpecFixtureJsxContainer {
  /**
  Данные композиции рабочей области и её части.

  @property title - Доступное имя рабочей области.

  @property content - Вход принадлежащей части, сохраняющий её типовой контракт.
  */
  type Input = {readonly title: string, readonly content: StorybookContractsSpecFixtureJsxContainerPart.Input}
  /**
  Области содержимого общей композиции.

  @property default - Основное содержимое рабочей области.

  @property [header] - Дополнительный заголовок композиции.
  */
  type Slots = {
    readonly default: JSX.Element
    readonly header?: JSX.Element
  }
  /**
  JSX-элемент рабочей области с сохранением контракта её слотов.
  */
  type Output = JSX.Element<Slots>
}
