import type {StorybookAppWebPagePackageScenarioModel} from "@storybook-app-web-page-package-scenario/model"

/** Контракт представления сценария preview. */
export declare namespace StorybookAppWebPagePackageScenarioPreview {
  /**
  @property placement - Положение общей сцены в px, вычисленное host по геометрии.
  @property app - Модель выбранного варианта и его выполнения.
  */
  type Input = Readonly<{
    placement: Readonly<{x: number; y: number}>
    app: StorybookAppWebPagePackageScenarioModel.Output
  }>
}
