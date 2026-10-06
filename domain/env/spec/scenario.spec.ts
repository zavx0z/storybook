import {describe, expect, test} from "bun:test"
import {readFile} from "node:fs/promises"
import {resolve} from "node:path"
import environment from "@zavx0z/storybook-domain-env"

describe.each([
  {name: "Базовое окружение", props: {directory: resolve(import.meta.dir, "../../../package/env/spec/fixture/plain")}},
  {name: "Дополнения собственного пакета", props: {directory: resolve(import.meta.dir, "../../../package/env/spec/fixture/extended")}},
])("$name", ({props}) => {
  const result = environment(props)

  test("Декларация", () => {
    expect(result, "Окружение содержит только ссылки на исходники правил, знаний и инструментов")
      .toEqual({rules: expect.any(Object), documents: expect.any(Object), tools: expect.any(Object)})
  })
  describe("Правила", () => {
    test.each(Object.entries(result.rules).map(([name, source]) => ({name, source})))("$name", async ({source}) => {
      const text = await readFile(source.path, "utf8")
      expect(text, "Правило собственного пакета читается по ссылке декларации и доступно для стартового контекста").toBeDefined()
    })
  })
  describe("Документы", () => {
    test.each(Object.entries(result.documents).map(([name, source]) => ({name, source})))("$name", async ({source}) => {
      const text = await readFile(source.path, "utf8")
      expect(text, "Исходный документ принадлежит своему владельцу; декларация ссылается на него без копирования").toBeDefined()
    })
  })
  describe("Части документов", () => {
    test.each(Object.entries(result.documents).flatMap(([parent, document]) =>
      Object.entries(document.children ?? {}).map(([name, source]) => ({name: `${parent} / ${name}`, source}))))("$name", async ({source}) => {
      expect(await readFile(source.path, "utf8"), "Самостоятельная часть документа читается по отдельному запросу; переходы находятся в декларации")
        .toMatch(/^# /u)
    })
  })
  describe("Инструменты", () => {
    test.each(Object.entries(result.tools).map(([name, source]) => ({name, source})))("$name", async ({source}) => {
      expect(await readFile(source.description.path, "utf8"), "Описание, вход и результат инструмента из его собственного источника").toBeDefined()
      expect(await readFile(source.implementation.path, "utf8"), "Публичная реализация подключается исполнителем; чтение исходника в сценарии её не запускает").toBeDefined()
    })
  })
})
