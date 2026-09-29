import type {ReadScenarioOutput} from "@storybook/app/scenarios"

/**
Наблюдения, из которых формируется руководство.

@property report - Полный завершённый отчёт одного запуска сценария.
*/
export interface CreateScenarioGuideInput {
  readonly report: ReadScenarioOutput
}
