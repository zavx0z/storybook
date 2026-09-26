import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario, type ReadScenarioInput} from "@storybook/app/scenarios"

test("Вывод Bun передаётся по мере выполнения и сохраняется в полном отчёте", async () => {
  const events: Parameters<NonNullable<ReadScenarioInput["onProgress"]>>[0][] = []
  const result = await readScenario({
    path: resolve(import.meta.dir, "fixture/progress.test.ts"),
    onProgress: event => events.push(event),
  })
  expect(events[0]?.phase).toBe("preparing")
  expect(events.at(-1)?.phase).toBe("reporting")
  expect(events.filter(event => event.stream === "stdout").map(event => event.text).join("")).toBe(result.stdout)
  expect(events.filter(event => event.stream === "stderr").map(event => event.text).join("")).toBe(result.stderr)
  expect(result.stdout).toContain("Привет 🌍")
  expect(result.stderr).toContain("Первая проверка")
  expect(result.exitCode).toBe(0)
})

test("Ошибка наблюдателя не меняет результат Bun", async () => {
  const result = await readScenario({path: resolve(import.meta.dir, "fixture/progress.test.ts"),
    onProgress: () => { throw new Error("Наблюдатель закрыт") }})
  expect(result.exitCode).toBe(0)
})
