import type {ScenarioModel} from "@scenario/model"

/** Контракт представления сценария result. */
export declare namespace ScenarioResult {
  /**
  @property app - Модель выбранного варианта, хода проверки и исходов вызовов.
  */
  type Input = Readonly<{
    app: ScenarioModel.Output
  }>
}
