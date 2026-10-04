import type {JSX} from "@immersive/jsx"

/** Формы взаимодействия самостоятельного владельца примера. */
export declare namespace ContractFixturePanel {
  /**
  Подпись самостоятельной панели.

  @property title - Доступное имя панели, передаваемое в aria-label.
  */
  type Input = {readonly title: string}
  /**
  Содержимое областей панели.

  @property default - Основное содержимое; отсутствие не допускается.

  @property [header] - Дополнительный заголовок панели.
  */
  type Slots = {
    readonly default: JSX.Element
    readonly header?: JSX.Element
  }
  /**
  JSX-элемент панели, сохраняющий типы объявленных слотов.
  */
  type Output = JSX.Element<Slots>
}
