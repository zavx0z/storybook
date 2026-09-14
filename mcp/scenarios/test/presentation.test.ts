import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "@archetypes/specs/scenarios"
import {presentScenarios, type ScenariosInput} from "../index"

describe("Границы представления", async () => {
  const owner = {kind: "repository" as const, path: resolve(import.meta.dir, "../spec/fixture/repository")}
  const source = resolve(owner.path, "spec/scenario.spec.ts")
  const raw = await readScenario({path: source})
  const input: ScenariosInput = {owner, source, prepared: {revision: "test", result: raw}}

  test("Чужой результат не смешивается с выбранным исходником", () => {
    expect(() => presentScenarios({...input, source: resolve(owner.path, "spec/scenario.spec.tsx")})).toThrow("другому сценарию")
  })
  test("Ревизия не подменяется отсутствующим значением", () => {
    expect(() => presentScenarios({...input, prepared: {revision: "", result: raw}})).toThrow("ревизия")
  })
  test("Редактирование ответа не меняет полный результат валидации", () => {
    const before = JSON.stringify(raw)
    const result = presentScenarios(input)
    Reflect.set(result.variants[0]!.items[0]!.assertions[0]!, "actual", "changed")
    expect(JSON.stringify(raw)).toBe(before)
  })
  test("У незавершённого пункта остаётся описание, но нет выдуманных actual", () => {
    const result = presentScenarios(input)
    const item = result.variants[0]!.categories[0]!.categories[0]!.items[1]!
    expect({status: item.status, reached: item.assertions, planned: item.unexecuted.map(item => item.customFailMessage)})
      .toEqual({status: "todo", reached: [], planned: ["Незавершённое требование"]})
  })
})
