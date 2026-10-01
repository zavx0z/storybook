/**
Показывает публичный вход и сценарий использования функции без её исполнения.
Правила соответствия Package и Component находятся в сценарии Package.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readComponent from "@archetypes/component"

describe.each([{name: "Функция увеличения числа", props: {path: resolve(import.meta.dir, "fixture/component")}}])("$name", async ({props}) => {
  const result = await readComponent(props)
  test("Публичная функция", () => {
    expect(result.entries.map(entry => entry.exports), "Публичный вход предоставляет increment; типы Input и Output не становятся runtime функциями")
      .toEqual([["default"]])
    expect(result.additionalCode, "Пример не публикует дополнительных реализаций").toEqual([])
  })
  test("Исполняемый пример", () => {
    expect(result.scenarios, "Сценарий increment находится у компонента и может быть запущен через тот же исполнитель")
      .toEqual([resolve(props.path, "spec/scenario.spec.ts")])
  })
})
