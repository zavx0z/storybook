import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {readImports} from "../src/imports"
import {traceScenario} from "../src/trace"

const directory = resolve(import.meta.dir, "fixture/imports")

test("именованный import наблюдает исходное имя и исключает type-only binding", async () => {
  expect(await readImports(resolve(directory, "scenario.test.ts"))).toEqual([
    {module: resolve(directory, "operations.ts"), names: ["visible"]},
    {module: resolve(directory, "consumer.ts"), names: ["consume"]},
  ])
})

test("namespace сохраняет доступ ко всем экспортам модуля", async () => {
  expect(await readImports(resolve(directory, "namespace.ts"))).toEqual([
    {module: resolve(directory, "operations.ts"), names: null},
  ])
})

test("вызовы внутри зависимостей не попадают в трассу именованного импорта", async () => {
  const result = await traceScenario({path: resolve(directory, "scenario.test.ts")})
  expect(result.exitCode).toBe(0)
  expect(result.calls.map(call => call.name)).toEqual(["visible", "consume"])
  expect(result.calls[1]?.outcome).toEqual({type: "return", value: 6})
}, 15000)
