import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from ".."

describe("Асинхронная подготовка вариантов", async () => {
  const result = await readScenario({path: resolve(import.meta.dir, "fixture/async-context-scenario.test.ts")})

  test("Штатный запуск", () => {
    expect(result.exitCode, "Инструментация сохраняет обычное исполнение Bun Test").toBe(0)
    expect(result.tests.map(item => item.status)).toEqual(Array(8).fill("passed"))
  })
  test("Группы вызовов до и после await", () => {
    for (const name of ["Первый", "Второй"]) {
      expect(result.calls.filter(call => call.args[0] === "до:" + name || call.args[0] === "после:" + name).map(call => call.describe)).toEqual([[name], [name]])
    }
  })
  test("Вложенная асинхронная группа", () => {
    for (const name of ["Первый", "Второй"]) {
      expect(result.calls.find(call => call.args[0] === "вложенный:" + name)?.describe).toEqual([name, "Вложенная группа"])
    }
  })
  test("Контекст теста не смешивается с подготовкой", () => {
    for (const name of ["Первый", "Второй"]) {
      expect(result.calls.find(call => call.args[0] === "тест:" + name)).toMatchObject({describe: [name], test: "Результат варианта"})
    }
    expect(result.calls.filter(call => !String(call.args[0]).startsWith("тест:")).map(call => call.test)).toEqual(Array(12).fill(null))
  })
  test("Hooks сохраняют группу и порядок жизненного цикла", () => {
    for (const name of ["Первый", "Второй"]) {
      const before = result.calls.find(call => call.args[0] === "beforeAll:" + name)!
      const running = result.calls.find(call => call.args[0] === "тест:" + name)!
      const after = result.calls.find(call => call.args[0] === "afterAll:" + name)!
      expect([before, after].map(call => ({describe: call.describe, test: call.test}))).toEqual([{describe: [name], test: null}, {describe: [name], test: null}])
      expect(before.id < running.id && running.id < after.id).toBeTrue()
    }
  })
})
