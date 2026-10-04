import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from "@zavx0z/storybook-specs-scenarios-reader"

const fixture = resolve(import.meta.dir, "fixture/default-class/spec")

test("default-класс получает preview из единственного настоящего new", async () => {
  const path = resolve(fixture, "scenario.spec.ts")
  expect(await readScenario.supportsPreview({path}), "Статическая проверка распознаёт прямое конструирование default-класса").toBeTrue()

  const report = await readScenario({path})
  expect(report.exitCode, report.stderr).toBe(0)
  expect(report.validation.checks.find(check => check.rule === "single-invocation")?.status).toBe("passed")
  expect(report.tests.map(point => point.status), "Результат и побочный эффект проверены настоящим Bun Test").toEqual(["passed"])
  const observed = report.calls.filter(call => call.module.endsWith("/default-class/index.ts") && call.name === "default")
  expect(observed, "Конструктор наблюдался один раз; подготовка preview не выполняет его повторно").toHaveLength(1)
  expect(observed[0]?.outcome).toEqual({type: "return", value: {value: 7}})

  expect(report.preview?.kind).toBe("function")
  if (report.preview?.kind !== "function") throw new Error("Нет представления конструктора")
  const variant = report.preview.variants[0]
  expect(variant?.calls).toHaveLength(1)
  expect(variant?.calls[0]?.id).toBe(observed[0]?.id)
  expect(variant?.calls[0]?.source).toBe("new ConstructedValue(7)")
  expect(variant?.source).toBe('import ConstructedValue from "@fixture/default-class"\n\nnew ConstructedValue(7)')
  expect(variant?.calls[0]?.outcome).toEqual(observed[0]?.outcome)
}, 30_000)

test.each([
  {name: "повторный new", file: "twice.spec.ts"},
  {name: "два локальных имени одного default", file: "ambiguous.spec.ts"},
])("$name не получает preview", async ({file}) => {
  const path = resolve(fixture, file)
  const report = await readScenario({path})
  expect(report.exitCode, report.stderr).toBe(0)
  expect(report.validation.checks.find(check => check.rule === "single-invocation")?.status).toBe("failed")
  expect(report.preview).toBeUndefined()
  await expect(readScenario.supportsPreview({path})).rejects.toThrow("один вызов")
}, 30_000)
