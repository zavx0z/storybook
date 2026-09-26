import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenarioGuide} from ".."
import {readSpecGuide} from "../.."

const owner = resolve(import.meta.dir, "../../../../app/scenarios/spec/fixture/function")

test("путь к сценарию достаточен для чтения кода, проверок и реальной структуры", async () => {
  const path = resolve(owner, "spec/scenario.spec.ts")
  const guide = await readScenarioGuide({path})
  expect(guide.files).toEqual([{path: "spec/scenario.spec.ts", role: "scenario"}, {path: "index.ts", role: "public-entry"}])
  expect(guide.examples[0]).toEqual({title: "Сценарий целиком", code: await Bun.file(path).text()})
  expect(guide.checks.find(check => check.rule === "execution")?.status).toBe("passed")
  expect(guide).not.toHaveProperty("stdout")
  expect(guide).not.toHaveProperty("calls")
})

test("путь к владельцу даёт то же руководство без ручной подготовки данных", async () => {
  expect(await readSpecGuide({path: owner})).toEqual(await readScenarioGuide({path: resolve(owner, "spec/scenario.spec.ts")}))
  expect(await readSpecGuide({path: resolve(owner, "missing")})).toBeNull()
})

test("ошибочный путь не подменяется произвольным отчётом", async () => {
  await expect(readScenarioGuide({path: resolve(owner, "index.ts")})).rejects.toThrow("Укажите файл spec/scenario.spec")
  await expect(readScenarioGuide({path: resolve(owner, "missing/spec/scenario.spec.ts")})).rejects.toThrow()
})
