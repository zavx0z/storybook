/**
Показывает правила и примеры написания спецификации выбранного владельца.
Чтение и запуск сценария поручает приложению Storybook.

@packageDocumentation
*/
import {readSpec} from "@storybook/app/spec-reader"
import {createScenarioGuide} from "./shared/scenario-guide"
import type {ReadSpecGuideInput} from "./contract/input"
import type {ReadSpecGuideOutput} from "./contract/output"

export type {ReadSpecGuideInput, ReadSpecGuideOutput}

/**
Находит непосредственный сценарий владельца и показывает его структуру и код.

@param input - Путь к владельцу спецификации.
@returns Руководство либо null, если у выбранного владельца нет сценария.
@throws Ошибки чтения и запуска спецификации из App.
*/
export async function readSpecGuide({path}: ReadSpecGuideInput): Promise<ReadSpecGuideOutput> {
  const result = await readSpec({path})
  return result?.scenario ? createScenarioGuide(result.scenario) : null
}
