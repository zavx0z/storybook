import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from "../index"

test("each titles совпадают с настоящим Bun JUnit для поддержанных percent placeholders", async () => {
  const result = await readScenario({path: resolve(import.meta.dir, "fixture/title-format-scenario.test.ts")})
  expect(result.exitCode).toBe(0)
  expect(result.tests).toHaveLength(58)
  expect(result.tests.every(test => test.status === "passed")).toBe(true)
  expect(result.tests.filter(test => test.label.startsWith("pretty ")).map(test => test.label)).toEqual([
    'pretty "text"', "pretty 42", 'pretty {\n  value: "object",\n}', "pretty null",
  ])
  expect(result.tests.filter(test => test.label.startsWith("index ")).map(test => test.label)).toEqual([
    "index 0 escaped %", "index 1 escaped %", "index 2 escaped %", "index 3 escaped %",
  ])
  expect(new Set(result.tests.map(test => test.id)).size).toBe(58)
  // Дублированные labels (%s/%i на несовместимом типе) имеют отдельные IDs и исходы.
  expect(result.tests.filter(test => test.label === "string %s")).toHaveLength(3)
}, 30000)

test("реальный PageTarget fallback %p trace связывает каждый зарегистрированный вариант с его JUnit исходом", async () => {
  const result = await readScenario({path: resolve(import.meta.dir, "../../../../app/web/page/target/spec/scenario.spec.ts")})
  expect(result.exitCode).toBe(0)
  expect(result.tests).toHaveLength(5)
  expect(result.tests.every(test => test.status === "passed")).toBe(true)
  expect(result.tests.filter(test => test.label.startsWith("fallback ")).map(test => test.label)).toEqual([
    'fallback не несёт скрытый executable payload или preview: {\n  revisionUrl: "/__storybook/revisions/old/",\n}',
    'fallback не несёт скрытый executable payload или preview: {\n  payloadUrl: "/__storybook/revisions/old/revision-payload.js",\n}',
    'fallback не несёт скрытый executable payload или preview: {\n  intent: "preview",\n  preview: true,\n}',
  ])
}, 30000)
