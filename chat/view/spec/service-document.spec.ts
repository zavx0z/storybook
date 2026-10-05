/** Форматирование служебных объектов сохраняет весь источник без consumer JSON parser. */
import {expect, test} from "bun:test"
import formatJson from "@zavx0z/storybook-tech-json-format"
import {serviceDocumentSource, serviceLanguageForMime} from "../src/service-document"

test("структурированное событие форматируется с отступами и сохраняет metadata", () => {
  const value = {status: "completed", input: {path: "file.ts"}, _meta: {provider: "agent", sequence: 2}}
  const result = formatJson(serviceDocumentSource(value))
  expect(result.languageId, "Структурированное значение выбирает штатную JSON-подсветку").toBe("json")
  expect(result.text, "Отступы раскрывают вложенные аргументы").toContain('  "input": {\n    "path": "file.ts"\n  }')
  expect(JSON.parse(result.text), "Форматированный полный документ сохраняет поля и metadata").toEqual(value)
})

test("текстовый JSON сохраняет точные лексемы, повторные ключи и весь хвост", () => {
  const source = '{"id":9007199254740993,"same":1,"same":2,"tail":"НЕ ОБРЕЗАТЬ"}'
  const result = formatJson(serviceDocumentSource(source))
  expect(result.languageId).toBe("json")
  expect(serviceDocumentSource(source), "Подготовка typed данных не перепечатывает строковый source").toBe(source)
  expect(result.text).toContain('"id": 9007199254740993')
  expect(result.text).toContain('"same": 1,\n  "same": 2')
  expect(result.text).toContain('"tail": "НЕ ОБРЕЗАТЬ"')
})

test("plain source и большой документ не обрезаются", () => {
  const source = Array.from({length: 2000}, (_, index) => `Строка ${index}`).join("\n") + "\nПОЛНЫЙ КОНЕЦ"
  const result = formatJson(serviceDocumentSource(source))
  expect(result.languageId, "Неизвестный текст не объявляется JSON").toBe("plaintext")
  expect(result.text, "Прокрутка видимой области не заменяется обрезкой документа").toBe(source)
})

test("native MIME задаёт язык, остальные URI остаются у resolver CodeEditor", () => {
  expect(serviceLanguageForMime("application/problem+json; charset=utf-8")).toBe("json")
  expect(serviceLanguageForMime("text/markdown")).toBe("markdown")
  expect(serviceLanguageForMime("text/plain")).toBeUndefined()
})
