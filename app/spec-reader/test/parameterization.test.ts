/** Проверяет различение внешних вариантов и вложенных категорий. @packageDocumentation */
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {findUnparameterizedDescribes} from "../spec/fixture"

test("учитывает только внешний describe без each", async () => {
  expect(await findUnparameterizedDescribes(resolve(import.meta.dir, "fixture/nested-describe.ts"))).toEqual(["describe"])
})

test("принимает явные категории теста readScenario", async () => {
  expect(await findUnparameterizedDescribes(resolve(import.meta.dir, "../../scenarios/test/read-scenario.test.ts"))).toEqual([])
})

test("принимает каркас сценариев функций и компонентов", async () => {
  expect(await findUnparameterizedDescribes(resolve(import.meta.dir, "../../../archetypes/specs/scenarios/spec/scenario.spec.ts"))).toEqual([])
})
