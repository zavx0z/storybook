import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario, supportsScenarioPreview} from "@storybook/app/scenarios"

describe("Представление readPackage", async () => {
  const path = resolve(import.meta.dir, "../../../archetypes/package/spec/scenario.spec.ts")
  const result = await readScenario({path})

  test("Поддержка", async () => {
    expect(await supportsScenarioPreview({path}), "Прямой вызов публичной функции распознаётся без компонентной фикстуры").toBeTrue()
  })
  test("Варианты и результаты", () => {
    expect(result.preview, "Представление функции содержит выполненный пример архетипа").toMatchObject({
      kind: "function",
      variants: [{title: "Архетип пакета"}],
    })
    if (result.preview?.kind !== "function") throw new Error("Нет представления функции")
    for (const variant of result.preview.variants) {
      expect(variant.calls).toHaveLength(1)
      for (const call of variant.calls) {
        const observed = result.calls.find(observed => observed.id === call.id)
        if (!observed) throw new Error("Нет исходного вызова")
        expect(call.outcome, "Результат взят из того же наблюдённого вызова без повторного выполнения")
          .toEqual(observed.outcome)
      }
      expect(variant.source).toContain('from "@archetypes/package"')
      expect(variant.source).toContain("await readPackage(")
      expect(variant.source).not.toContain("process.env")
      expect(variant.points).not.toHaveLength(0)
    }
  })
  test("Граница сервера", () => {
    expect(result.preview).toBeDefined()
    expect(result.preview, "Представление функции не содержит модуля для исполнения в браузере").not.toHaveProperty("module")
  })
})

describe("Точность снимков функции", async () => {
  const path = resolve(import.meta.dir, "fixture/function-preview/spec/scenario.spec.ts")
  const result = await readScenario({path})
  const preview = result.preview
  if (preview?.kind !== "function") throw new Error("Нет представления функции")

  test("Пустые и специальные значения", () => {
    expect(preview.variants.slice(0, 7).map(variant => variant.calls[0]?.outcome)).toEqual([
      {type: "resolve", value: 0}, {type: "resolve", value: false}, {type: "resolve", value: ""},
      {type: "resolve", value: []}, {type: "resolve", value: {}},
      {type: "resolve", value: {$type: "undefined"}}, {type: "resolve", value: {$type: "number", value: "NaN"}},
    ])
  })
  test("Один вызов на вариант", () => {
    expect(preview.variants.map(variant => variant.calls.length)).toEqual(Array(10).fill(1))
    expect(preview.variants.find(variant => variant.title === "Null")?.calls[0]?.outcome).toEqual({type: "resolve", value: null})
    expect(result.calls.filter(call => call.name === "evaluate")).toHaveLength(10)
    expect(result.validation.checks.find(check => check.rule === "single-invocation")?.status).toBe("passed")
  })
  test("Импортированное значение", () => {
    const source = preview.variants.find(variant => variant.title === "Импортированная функция")?.source
    expect(source, "Импортированная функция остаётся именованной ссылкой в восстановленном вызове").toContain(
      'import {sampleValue} from "@fixture/function-preview"',
    )
    expect(source, "Вызов использует исходное имя вместо служебной метки функции").toContain('"value": sampleValue')
  })
  test("Отказ", () => {
    expect(preview.variants.at(-1)?.calls[0]?.outcome).toMatchObject({type: "reject", error: {message: "Ошибка примера"}})
  })
})
