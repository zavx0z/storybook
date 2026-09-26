/**
Объясняет написание сценария по его файлу и структуре владельца.
Чтение и запуск поручает App; из полного отчёта выбирает кодовые примеры и проверки.

@packageDocumentation
*/
import {basename, dirname, resolve} from "node:path"
import {readScenario} from "@storybook/app/scenarios"
import {createScenarioGuide} from "../shared/scenario-guide"
import type {ReadScenarioGuideInput} from "./contract/input"
import type {ReadScenarioGuideOutput} from "./contract/output"

export type {ReadScenarioGuideInput, ReadScenarioGuideOutput}

/**
Читает указанный сценарий через App и собирает руководство его написания.
Связанные файлы определяет рядом со сценарием; передавать технический отчёт не требуется.

@param input - Путь к файлу сценария его непосредственного владельца.
@returns Файлы примера, исходный код и результаты проверки сценария.
@throws TypeError, если путь не указывает на spec/scenario.spec.ts либо spec/scenario.spec.tsx.
@throws Ошибки чтения и запуска сценария из App.
*/
export async function readScenarioGuide({path}: ReadScenarioGuideInput): Promise<ReadScenarioGuideOutput> {
  const source = resolve(path)
  if (basename(dirname(source)) !== "spec" || !/^scenario\.spec\.tsx?$/u.test(basename(source))) {
    throw new TypeError("Укажите файл spec/scenario.spec.ts либо spec/scenario.spec.tsx владельца")
  }
  return createScenarioGuide(await readScenario({path: source}))
}
