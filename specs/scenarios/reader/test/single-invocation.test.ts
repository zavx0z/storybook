import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from "@archetypes/scenario-reader"

test.each([
  {name: "нет вызова", file: "fixture/function-preview/spec/none.spec.ts", status: "failed"},
  {name: "один вызов и другая функция", file: "fixture/function-preview/spec/helper.spec.ts", status: "passed"},
  {name: "два вызова при подготовке", file: "fixture/function-preview/spec/twice.spec.ts", status: "failed"},
  {name: "повторение в test", file: "fixture/function-preview/spec/inside-test.spec.ts", status: "failed"},
  {name: "повторный render", file: "../spec/fixture/component/spec/repeated.spec.tsx", status: "failed"},
])("Один вызов: $name", async ({file, status}) => {
  const report = await readScenario({path: resolve(import.meta.dir, file)})
  expect(report.exitCode).toBe(0)
  const check = report.validation.checks.find(check => check.rule === "single-invocation")
  expect(check?.status).toBe(status)
  if (status === "failed") {
    expect(check?.issues.length).toBeGreaterThan(0)
    expect(report.preview).toBeUndefined()
    await expect(readScenario.supportsPreview({path: report.path})).rejects.toThrow("один вызов")
  }
}, 30_000)
