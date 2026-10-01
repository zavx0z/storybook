import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "../index"

describe("Native регистрация без подмены варианта", async () => {
  const result = await readScenario({path: resolve(import.meta.dir, "fixture/aliased-scenario.test.ts"), testNamePattern: "Два (Второй|Callback)"})

  test("Фильтр сохраняет фактически выбранную строку test.each", () => {
    expect(result.assertions.find(item => item.test === "Второй")).toMatchObject({describe: ["Два"], actual: 2, status: "passed"})
  })
  test("Пропущенные строки не получают чужие утверждения", () => {
    expect(result.tests.filter(item => item.status === "skipped").every(item => !result.assertions.some(assertion => assertion.testId === item.id))).toBeTrue()
  })
  test("Callback done сохраняет native жизненный цикл", () => {
    expect(result.tests.filter(item => item.status === "passed").map(item => item.label)).toEqual(["Второй", "Callback завершения"])
  })
})
