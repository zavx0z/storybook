/**
Читает данные спецификации у непосредственного владельца.

@packageDocumentation
*/
import {resolve} from "node:path"
import {readScenario} from "./scenarios"
import type {ReadSpecInput} from "./contract/input"
import type {ReadSpecOutput} from "./contract/output"
import {findSpec} from "./src/find-spec"

export type {ReadSpecInput, ReadSpecOutput}

/**
Находит непосредственную директорию spec и читает результат её сценария.

@param path - Директория владельца спецификации.
@returns Данные сценария либо null, если директории spec нет.
Поле scenario равно null, если файл сценария отсутствует.
@throws Ошибки чтения и запуска сценария; ошибка при наличии обоих расширений.
*/
export async function readSpec({path}: ReadSpecInput): Promise<ReadSpecOutput> {
  const specPath = await findSpec(path)
  if (specPath === null) return null

  const scenarioPaths = [
    resolve(specPath, "scenario.spec.ts"),
    resolve(specPath, "scenario.spec.tsx"),
  ]
  const existingPaths = []
  for (const scenarioPath of scenarioPaths) {
    if (await Bun.file(scenarioPath).exists()) existingPaths.push(scenarioPath)
  }
  if (existingPaths.length > 1) {
    throw new Error("Спецификация содержит одновременно scenario.spec.ts и scenario.spec.tsx")
  }

  return {
    scenario: existingPaths[0] ? await readScenario({path: existingPaths[0]}) : null,
  }
}
