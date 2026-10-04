/** Публичное чтение возвращает данные сценариев выбранного владельца. */
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenarios from "@storybook-specs/presentation"

describe.each([
  {name: "Репозиторий", props: {path: resolve(import.meta.dir, "fixture/repository"), format: "data" as const}},
  {name: "Сущность", props: {path: resolve(import.meta.dir, "fixture/entity"), format: "data" as const}},
  {name: "Пакет", props: {path: resolve(import.meta.dir, "fixture/package"), format: "data" as const}},
])("$name", async ({props}) => {
  const result = await readScenarios(props)
  const scenarios = result.scenarios
  if (!("variants" in scenarios)) throw new Error("Ожидается полное представление data")
  test("Выбранный владелец", () => {
    expect(scenarios.owner.path, "Ответ сохраняет физический адрес проверенного владельца").toBe(props.path)
    expect(scenarios.source, "Источник остаётся непосредственным сценарием владельца").toBe(resolve(props.path, "spec/scenario.spec.ts"))
  })
  test("Результаты вариантов", () => {
    expect(scenarios.variants.map(variant => variant.label), "Публичное чтение выполняет оба варианта исходного сценария")
      .toEqual(["Обычный", "Пустой"])
    expect(scenarios.revision, "Данные относятся к конкретному выполнению сценария").toMatch(/\S/u)
  })
})
