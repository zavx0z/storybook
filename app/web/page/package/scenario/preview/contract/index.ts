import type {ScenarioModel} from "@scenario/model"

/** Контракт представления сценария preview. */
export declare namespace ScenarioPreview {
  /**
  @property app - Модель выбранного варианта и его выполнения.
  */
  type Input = Readonly<{
    app: ScenarioModel.Output
  }>
}
