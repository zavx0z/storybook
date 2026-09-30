import {afterAll, expect, test} from "bun:test"
import {cp, mkdtemp, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import {readScenario} from "@storybook/app/scenarios"
import {readScenarios} from "../../../mcp/rest/scenarios"

const scenario = resolve(import.meta.dir, "../spec/scenario.spec.ts")
const roots: string[] = []
afterAll(async () => {
  for (const root of roots) await rm(root, {recursive: true, force: true})
})

test.each([
  ["Domain", resolve(import.meta.dir, "../..")],
  ["Component", resolve(import.meta.dir, "../../../component/spec/fixture/component")],
] as const)("один сценарий проверяет %s и предоставляет те же данные представлениям", async (role, path) => {
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.exitCode, report.stderr).toBe(0)
  expect(report.validation.checks.filter(check => check.status === "failed")).toEqual([])
  expect(report.tests.filter(point => point.status !== "passed" && !(point.status === "skipped" && point.skipReason))).toEqual([])
  expect(report.calls.filter(call => call.name === "default")).toHaveLength(1)
  expect(report.preview?.kind).toBe("function")
  expect(report.groups.some(group => group.label === role)).toBeTrue()
  const document = await readScenarios({
    path: resolve(import.meta.dir, ".."),
    prepared: {revision: "same-execution", result: {scenario: report}},
  })
  const serialized = JSON.stringify(document)
  expect(serialized).toContain(role)
  expect(serialized).toContain("Корневой TSDoc раскрывает назначение и границы ответственности пакета")
  expect(serialized).toContain(path)
}, 30_000)

test("подтверждение роли не скрывает провал последующего требования Component", async () => {
  const path = await realpath(await mkdtemp(resolve(tmpdir(), "package-standard-")))
  roots.push(path)
  await cp(resolve(import.meta.dir, "../../../component/spec/fixture/component"), path, {recursive: true})
  await rm(resolve(path, "contract/output.ts"))
  // Файловая проверка не исполняет component: импорт отсутствующего типа не маскирует нарушение.
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.tests.find(point => point.label === "Структурная роль")?.status).toBe("passed")
  expect(report.tests.find(point => point.label === "Результат")?.status).toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)

test("отсутствие роли остаётся нарушением с наблюдаемыми данными, а не успехом пустого набора", async () => {
  const path = await realpath(await mkdtemp(resolve(tmpdir(), "package-unclassified-")))
  roots.push(path)
  await writeFile(resolve(path, "package.json"), JSON.stringify({name: "@fixture/empty", description: "Пустой пакет", exports: {".": "./index.ts"}}))
  await writeFile(resolve(path, "index.ts"), "/** Пустой пакет. @packageDocumentation */\nexport {}")
  const report = await readScenario({path: scenario, props: {path}})
  expect(report.tests.find(point => point.label === "Структурная роль")?.status).toBe("failed")
  expect(report.exitCode).not.toBe(0)
}, 30_000)
