import {beforeAll, expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario, {type StorybookSpecsScenariosReader} from "@storybook-specs-scenarios/reader"
import validateScenario from "@storybook-specs-scenarios-reader/validation"
import {readScenarioSource} from "../src/read-source"

const path = resolve(import.meta.dir, "../spec/fixture/component/spec/scenario.spec.tsx")
let report: StorybookSpecsScenariosReader.Output

beforeAll(async () => {
  report = await readScenario({path})
}, 30_000)

test("журнал native mock входит в общий отчёт как фактические данные", () => {
  expect(report.exitCode).toBe(0)
  expect(report.validation.checks.find(check => check.rule === "direct-execution")?.status).toBe("passed")
  expect(report.assertions.filter(item => item.test === "Обратный вызов").map(item => ({actual: item.actual, status: item.status}))).toEqual([
    {actual: [["Продолжить"]], status: "passed"},
    {actual: [], status: "passed"},
  ])
  expect(report.validation.checks.find(check => check.rule === "single-invocation")?.status).toBe("passed")
  expect(report.calls.filter(call => call.name.endsWith(".render"))).toHaveLength(2)
  expect(report.source.subject?.calls).toHaveLength(1)
  expect(report.preview?.kind).toBe("component")
  if (report.preview?.kind === "component") {
    expect(report.preview.module.source).toContain("onActivate: () => undefined")
    expect(report.preview.module.source).not.toContain("bun:test")
    expect(report.preview.variants[0]?.source).toContain("mock<(label: string) => void>()")
  }
  expect(report.preview?.variants.map(variant => variant.points.at(-1)?.title)).toEqual([
    "Использование / Обратный вызов", "Использование / Обратный вызов",
  ])
})

test("повторный выбранный запуск получает свежий журнал", async () => {
  const selected = await readScenario({path, variant: 0})
  expect(selected.exitCode).toBe(0)
  expect(selected.assertions.find(item => item.test === "Обратный вызов")?.actual).toEqual([["Продолжить"]])
}, 30_000)

test("проверка выявляет неправильный аргумент callback", async () => {
  const changed = await readScenario({path, variant: 0, props: {label: "Другая команда"}})
  expect(changed.exitCode).not.toBe(0)
  expect(changed.assertions.find(item => item.test === "Обратный вызов")).toMatchObject({
    actual: [["Другая команда"]], expected: [[["Продолжить"]]], status: "failed",
  })
}, 30_000)

test("наблюдение callback отличается от подмены модуля, включая alias импорта", async () => {
  const source = await readScenarioSource(resolve(import.meta.dir, "fixture/module-mock.ts"))
  expect(source.native).toEqual(["mock", "mock.module"])
  expect(validateScenario(source, report).checks.find(check => check.rule === "direct-execution")?.status).toBe("failed")
})
