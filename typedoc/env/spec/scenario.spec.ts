import {describe, expect, test} from "bun:test"
import readFixture from "./fixture/read"
import environment from "@zavx0z/storybook-typedoc-env"

describe.each([
  {name: "Базовое окружение", props: {directory: "package/env/spec/fixture/plain"}},
  {name: "Дополнения собственного пакета", props: {directory: "package/env/spec/fixture/extended"}},
])("$name", ({props}) => {
  const fixture = readFixture(props.directory)
  const result = environment(props)

  test("Декларация", () => {
    expect(result, "Окружение содержит только ссылки на исходники правил, знаний и инструментов")
      .toEqual({rules: expect.any(Object), documents: expect.any(Object), tools: expect.any(Object)})
  })
  describe("Правила", () => {
    test.each(Object.entries(result.rules).map(([name, source]) => ({name, source})))("$name", async ({source}) => {
      const text = fixture.read(source)
      expect(text, "Правило собственного пакета читается по ссылке декларации и доступно для стартового контекста").toBeDefined()
    })
  })
  describe("Документы", () => {
    test.each(Object.entries(result.documents).map(([name, source]) => ({name, source})))("$name", async ({source}) => {
      const text = fixture.read(source)
      expect(text, "Исходный документ принадлежит своему владельцу; декларация ссылается на него без копирования").toBeDefined()
    })
  })
  describe("Инструменты", () => {
    test.each(Object.entries(result.tools).map(([name, source]) => ({name, source})))("$name", async ({source}) => {
      expect(fixture.read(source.description), "Описание, вход и результат инструмента из его собственного источника").toBeDefined()
      expect(fixture.source(source.implementation), "Публичная реализация подключается исполнителем; чтение исходника в сценарии её не запускает").toBeDefined()
    })
  })
})
