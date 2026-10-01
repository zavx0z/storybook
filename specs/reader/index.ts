/**
Читает данные спецификации у непосредственного владельца.

@packageDocumentation
*/
import {resolve} from "node:path"
import readScenario from "@archetypes/scenario-reader"
import type {ArchetypesSpecReader} from "./contract"
import {findSpec} from "./src/find-spec"

export type {ArchetypesSpecReader} from "./contract"

/**
Находит непосредственную директорию spec и читает результат её сценария.

@param path - Директория владельца спецификации.
@returns Данные сценария либо null, если директории spec нет.
Поле scenario равно null, если файл сценария отсутствует.
@throws Ошибки чтения и запуска сценария; ошибка при наличии обоих расширений.
*/
export default async function readSpec({path}: ArchetypesSpecReader.Input): Promise<ArchetypesSpecReader.Output> {
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
