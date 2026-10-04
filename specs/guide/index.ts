/**
Показывает правила и примеры написания спецификации выбранного владельца.
Чтение и запуск сценария поручает читателю Specs.

@packageDocumentation
*/
import readSpec from "@zavx0z/storybook-specs-reader"
import createScenarioGuide from "@zavx0z/storybook-specs-document"
import type {Zavx0zStorybookSpecsGuide} from "./contract"

export type {Zavx0zStorybookSpecsGuide} from "./contract"

/**
Находит непосредственный сценарий владельца и показывает его структуру и код.

@param input - Путь к владельцу спецификации.
@returns Руководство либо null, если у выбранного владельца нет сценария.
@throws Ошибки чтения и запуска спецификации читателем Specs.
*/
export default async function readSpecGuide({path}: Zavx0zStorybookSpecsGuide.Input): Promise<Zavx0zStorybookSpecsGuide.Output> {
  const result = await readSpec({path})
  return result?.scenario ? createScenarioGuide({report: result.scenario}) : null
}
