import type {ScenarioModel} from "@scenario/model"

/** Контракт представления сценария preview. */
export declare namespace ScenarioPreview {
  /**
  @property placement - Положение общей сцены в px, вычисленное host по геометрии.
  @property app - Модель выбранного варианта и его выполнения.
  */
  type Input = Readonly<{
    placement: Readonly<{x: number; y: number}>
    app: ScenarioModel.Output
  }>
}
