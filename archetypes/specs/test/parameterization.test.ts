/** Проверяет различение внешних вариантов и вложенных категорий. @packageDocumentation */
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {findUnparameterizedDescribes} from "../spec/fixture"

test("учитывает только внешний describe без each", async () => {
  expect(await findUnparameterizedDescribes(resolve(import.meta.dir, "fixture/nested-describe.ts"))).toEqual(["describe"])
})

test("принимает явные категории сценария трассировки", async () => {
  expect(await findUnparameterizedDescribes(resolve(import.meta.dir, "../scenarios/spec/scenario.spec.ts"))).toEqual([])
})
