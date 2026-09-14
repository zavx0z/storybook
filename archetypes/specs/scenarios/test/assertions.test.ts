import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "../index"

describe("Утверждения и штатные исходы", async () => {
  const path = resolve(import.meta.dir, "fixture/assertion-scenario.test.ts")
  const result = await readScenario({path, env: {TRACE_ASSERTIONS_FAILURE: "1"}})

  test("Обычные значения не означают отсутствие выполнения", () => {
    expect(result.assertions.filter(item => item.test === "Значения").map(item => item.actual)).toEqual([null, "", [], null, "", []])
  })
  test("Несколько matcher одного expect сохраняются отдельно", () => {
    expect(result.assertions.filter(item => item.test === "Повторное утверждение").map(item => [item.matcher, item.modifiers])).toEqual([
      ["toBeGreaterThan", []], ["toBe", ["not"]], ["toBeGreaterThan", []], ["toBe", ["not"]],
    ])
  })
  test("Асинхронные matchers завершаются до отчёта", () => {
    expect(result.assertions.filter(item => item.test === "Асинхронное значение")).toMatchObject([
      {status: "passed", modifiers: ["resolves"]}, {status: "passed", modifiers: ["resolves"]},
    ])
  })
  test("Условия типов не превращаются в одинаковые пустые объекты", () => {
    expect(result.assertions.find(item => item.test === "Асимметричные условия")?.expected).toEqual([{
      number: {$type: "matcher", name: "any", modifiers: [], args: [{$type: "function", name: "Number"}]},
      text: {$type: "matcher", name: "any", modifiers: [], args: [{$type: "function", name: "String"}]},
    }])
  })
  test("Первая ошибка прекращает выполнение последующих expect", () => {
    const selected = result.tests.find(item => item.label === "Прерывание")!
    expect({status: selected.status, declared: selected.assertions.length, reached: result.assertions.filter(item => item.testId === selected.id).length})
      .toEqual({status: "failed", declared: 2, reached: 1})
  })
  test("Ошибка количества утверждений принадлежит тесту", () => {
    expect(result.tests.find(item => item.label === "Число утверждений")?.status).toBe("failed")
  })
  test("failing не превращает ошибку matcher в ошибку теста", () => {
    expect(result.tests.filter(item => item.label === "Ожидаемое падение").map(item => item.status)).toEqual(["passed", "passed"])
  })
  test("Пропуск и todo различимы", () => {
    expect(result.tests.filter(item => ["Пропуск", "Позже"].includes(item.label)).map(item => [item.label, item.status])).toEqual([
      ["Пропуск", "skipped"], ["Позже", "todo"], ["Пропуск", "skipped"], ["Позже", "todo"],
    ])
  })
  test("Причина пропуска сохраняется из исходника", () => {
    expect(result.tests.find(item => item.label === "Пропуск")?.skipReason).toBe("Число этого варианта не требует специальной проверки.")
  })
  test("Описание todo доступно без исполнения тела", () => {
    expect(result.tests.find(item => item.label === "Позже")?.assertions[0]).toMatchObject({
      customFailMessage: "Незавершённое требование", source: 'expect(value, "Незавершённое требование")',
    })
  })
  test("Группы сохраняют параметры и родителей", () => {
    expect(result.groups.filter(item => item.parentId === null).map(item => [item.label, item.parameters])).toEqual([
      ["Первый", {name: "Первый", value: 1}], ["Второй", {name: "Второй", value: 2}], ["Ошибки", null],
    ])
  })
  test("Штатный отчёт сохраняется целиком", () => {
    expect(result.junit).toContain("<failure")
  })
})
