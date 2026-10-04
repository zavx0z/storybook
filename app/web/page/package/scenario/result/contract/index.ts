import type {StorybookAppWebPagePackageScenarioModel} from "@zavx0z/storybook-app-web-page-package-scenario-model"

/** Контракт представления сценария result. */
export declare namespace StorybookAppWebPagePackageScenarioResult {
  /**
  @property app - Модель выбранного варианта, хода проверки и исходов вызовов.
  */
  type Input = Readonly<{
    app: StorybookAppWebPagePackageScenarioModel.Output
  }>
}
