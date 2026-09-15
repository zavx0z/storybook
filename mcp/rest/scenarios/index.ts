/**
Выполняет сценарий выбранного владельца и возвращает данные для HTTP-ответа.

@packageDocumentation
*/
import {randomUUID} from "node:crypto"
import {resolve} from "node:path"
import {readSpec} from "@archetypes/specs"
import type {ReadScenariosInput} from "./contract/input"
import type {ReadScenariosOutput} from "./contract/output"
import {presentScenarios} from "./src/presentation"

export type {ReadScenariosInput, ReadScenariosOutput}

/** Читает публичную спецификацию либо использует результат уже применённой ревизии. */
export async function readScenarios({path, source: expectedSource, prepared, format = "document", selection}: ReadScenariosInput): Promise<ReadScenariosOutput> {
  if (format === "data" && selection !== undefined) throw new Error("Режим data возвращает все данные без выбора темы")
  const owner = {path, kind: await Bun.file(resolve(path, "package.json")).exists() ? "package" as const : "entity" as const}
  const revision = prepared?.revision ?? randomUUID()
  const spec = prepared === undefined ? await readSpec({path}) : prepared.result
  const result = spec?.scenario ?? null
  const source = result?.path ?? null
  if (expectedSource !== undefined && source !== resolve(expectedSource)) throw new Error("Публичная спецификация вернула другой сценарий")
  const input = {owner, source, prepared: result === null ? null : {revision, result}}
  return format === "document"
    ? {scenarios: presentScenarios(input, {format: "document", ...selection})}
    : {scenarios: presentScenarios(input)}
}
