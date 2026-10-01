/**
Показывает правила и примеры написания спецификации выбранного владельца.
Чтение и запуск сценария поручает читателю Specs.

@packageDocumentation
*/
import readSpec from "@archetypes/spec-reader"
import createScenarioGuide from "@archetypes/scenario-document"
import type {SpecsGuide} from "./contract"

export type {SpecsGuide} from "./contract"

/**
Находит непосредственный сценарий владельца и показывает его структуру и код.

@param input - Путь к владельцу спецификации.
@returns Руководство либо null, если у выбранного владельца нет сценария.
@throws Ошибки чтения и запуска спецификации читателем Specs.
*/
export default async function readSpecGuide({path}: SpecsGuide.Input): Promise<SpecsGuide.Output> {
  const result = await readSpec({path})
  return result?.scenario ? createScenarioGuide({report: result.scenario}) : null
}
