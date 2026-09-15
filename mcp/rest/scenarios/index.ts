/**
Выполняет сценарий выбранного владельца и возвращает данные для HTTP-ответа.

@packageDocumentation
*/
import {resolve} from "node:path"
import {randomUUID} from "node:crypto"
import {readScenario} from "@archetypes/specs/scenarios"
import type {ReadScenariosInput} from "./contract/input"
import type {ReadScenariosOutput} from "./contract/output"
import {presentScenarios} from "./src/presentation"

export type {ReadScenariosInput, ReadScenariosOutput}

/** Проверяет принадлежность до запуска теста. Кэширование ещё не подключено. */
export async function readScenarios({path, source, format = "tree", selection}: ReadScenariosInput): Promise<ReadScenariosOutput> {
  if (format === "data" && selection !== undefined) throw new Error("Режим data возвращает все данные без выбора темы")
  const owner = {path, kind: await Bun.file(resolve(path, "package.json")).exists() ? "package" as const : "entity" as const}
  presentScenarios({owner, source, prepared: null})
  const result = await readScenario({path: source})
  return {
    scenarios: presentScenarios(
      {owner, source, prepared: {revision: randomUUID(), result}},
      format === "tree" ? {format: "tree", ...selection} : undefined,
    ),
  }
}
