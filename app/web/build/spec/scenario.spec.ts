/** Явная подготовка Web сохраняет кандидата и объявленные им версии. */
import {describe, expect, test} from "bun:test"
import WebBuild from "@storybook-app-web/build"

describe.each([
  {name: "Одна версия", props: {candidate: {entry: "page.js"}, versions: [{kind: "web", epoch: "a"}]}},
  {name: "Несколько версий", props: {candidate: {entry: "package.js"}, versions: [{kind: "web", epoch: "b"}, {kind: "host", epoch: "c"}]}},
])("$name", async ({props}) => {
  let preparations = 0
  const result = await WebBuild.prepare<{entry: string}, {kind: string; epoch: string}>({
    prepare: async () => { preparations += 1; return props.candidate },
    versions: () => props.versions,
  }, new AbortController().signal)

  test("Кандидат", () => {
    expect(result.candidate, "Результат содержит ровно подготовленного кандидата").toBe(props.candidate)
  })
  test("Версии", () => {
    expect(result.versions, "Версии кандидата сохраняют объявленный состав и порядок").toEqual(props.versions)
    expect(Object.isFrozen(result.versions), "После подготовки перечень версий неизменяем").toBeTrue()
  })
  test("Один запуск", () => {
    expect(preparations, "Запрос готовит кандидата один раз").toBe(1)
  })
})
