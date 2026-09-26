import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "@storybook/app/scenarios"

describe("Структурный разбор исходника", async () => {
  const result = await readScenario({path: resolve(import.meta.dir, "fixture/invalid-authoring.test.ts")})

  test("Непараметризованная группа распознаётся и через псевдоним", () => {
    expect(result.validation.checks.find(check => check.rule === "parameterization")?.issues).toEqual([
      {message: expect.stringContaining("describe.each"), location: {path: result.path, line: 4, column: 1}},
    ])
  })
  test("Отсутствующее и вынесенное описания различимы", () => {
    expect(result.source.assertions.filter(item => !item.inline).map(item => item.message)).toEqual([null, "message"])
  })
  test("Обычный пустой тест не смешивается с todo", () => {
    expect(result.source.tests.filter(item => !item.todo && item.assertions === 0).map(item => item.label)).toEqual(['"Пустой тест"'])
  })
  test("Регистрация внутри помощника видна отдельно", () => {
    expect(result.validation.checks.find(check => check.rule === "explicit-registration")?.issues).toEqual([
      {message: expect.stringContaining("Спрятанный тест"), location: {path: result.path, line: 13, column: 3}},
    ])
  })
  test("Пропуск без пояснения не признаётся документированным", () => {
    expect(result.validation.checks.find(check => check.rule === "skip-description")?.issues).toHaveLength(1)
  })
  test("Успешное выполнение не скрывает нарушения оформления", () => {
    expect(result.exitCode).toBe(0)
    expect(result.validation.status).toBe("failed")
    expect(result.validation.checks.filter(check => check.status === "failed").map(check => check.rule)).toEqual([
      "file-location", "parameterization", "explicit-registration", "inline-description", "skip-description", "assertions",
    ])
    expect(result.assertions.filter(assertion => assertion.status === "passed")).toHaveLength(2)
  })
})

describe("Точность примеров руководства", async () => {
  const result = await readScenario({path: resolve(import.meta.dir, "fixture/shape-examples.test.ts")})

  test("toEqual с числом, массивом или spread не выдаётся за явный состав объекта", () => {
    expect(result.source.checks.map(check => check.explicitObject)).toEqual([false, false, true, false, false, true])
  })
  test("beforeAll не выдаётся за hook завершения", () => {
    expect(result.source.hooks.map(hook => hook.name)).toEqual(["beforeAll"])
    expect(result.source.hooks.filter(hook => hook.name === "afterAll" || hook.name === "afterEach")).toEqual([])
  })
})

describe("Полное чтение корректного сценария", async () => {
  const path = resolve(import.meta.dir, "../spec/fixture/function/spec/scenario.spec.ts")
  const result = await readScenario({path})

  test("Структура и выполнение относятся к одному исходнику", async () => {
    expect(result.source.path).toBe(result.path)
    expect(result.source.text).toBe(await Bun.file(path).text())
    expect(result.calls.filter(call => call.name === "summarizeNumbers")).toHaveLength(2)
  })
  test("Реализованные правила не находят нарушений", () => {
    expect(result.validation.checks.filter(check => check.status === "failed")).toEqual([])
  })
  test("Нереализованные проверки не становятся успешной валидацией", () => {
    expect(result.validation.status).toBe("incomplete")
    expect(result.validation.checks.filter(check => check.status === "not-checked").map(check => check.rule)).toEqual([
      "public-entry", "fixture-ownership", "result-dataflow", "resource-cleanup", "meaning",
    ])
  })
})

test("Чтение и валидация не импортируют фикстуры спецификаций", async () => {
  const directory = resolve(import.meta.dir, "../src")
  const imports: string[] = []
  for (const path of new Bun.Glob("*.ts").scanSync({cwd: directory, absolute: true})) {
    imports.push(...new Bun.Transpiler({loader: "ts"}).scanImports(await Bun.file(path).text()).map(item => item.path))
  }
  expect(imports.filter(path => /(?:^|\/)fixture(?:\/|$)/u.test(path))).toEqual([])
})
