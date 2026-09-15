import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {inspectScenarioSource} from "../spec/fixture"

describe("Структурный разбор исходника", async () => {
  const result = await inspectScenarioSource(resolve(import.meta.dir, "fixture/invalid-authoring.ts"))

  test("Непараметризованная группа распознаётся и через псевдоним", () => {
    expect(result.unparameterized).toEqual(["describe"])
  })
  test("Отсутствующее и вынесенное описания различимы", () => {
    expect(result.assertions.filter(item => !item.inline).map(item => item.message)).toEqual([null, "message"])
  })
  test("Обычный пустой тест не смешивается с todo", () => {
    expect(result.tests.filter(item => !item.todo && item.assertions === 0).map(item => item.label)).toEqual(['"Пустой тест"'])
  })
  test("Регистрация внутри помощника видна отдельно", () => {
    expect(result.hidden).toEqual(['"Спрятанный тест"'])
  })
  test("Пропуск без пояснения не признаётся документированным", () => {
    expect(result.undocumentedSkips).toEqual(['"Без пояснения"'])
  })
})

describe("Точность примеров руководства", async () => {
  const result = await inspectScenarioSource(resolve(import.meta.dir, "fixture/shape-examples.ts"))

  test("toEqual с числом, массивом или spread не выдаётся за явный состав объекта", () => {
    expect(result.checks.map(check => check.explicitObject)).toEqual([false, false, true, false, false, true])
  })
  test("beforeAll не выдаётся за hook завершения", () => {
    expect(result.hooks.map(hook => hook.name)).toEqual(["beforeAll"])
    expect(result.hooks.filter(hook => hook.name === "afterAll" || hook.name === "afterEach")).toEqual([])
  })
})
