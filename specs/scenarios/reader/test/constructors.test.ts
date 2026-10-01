import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from ".."

test("наблюдение импортов сохраняет конструкторы и их использование внутри библиотеки", async () => {
  const result = await readScenario({path: resolve(import.meta.dir, "fixture/constructors.spec.ts")})
  expect(result.exitCode).toBe(0)
  expect(result.tests.every(test => test.status === "passed")).toBeTrue()
  expect(result.calls.filter(call => call.name === "Counter").map(call => call.args)).toEqual([[3], [7]])
  expect(result.calls.filter(call => call.name === "Counter").every(call => call.outcome.type === "return")).toBeTrue()
}, 15000)
