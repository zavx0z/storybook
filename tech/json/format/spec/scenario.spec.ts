/** Полное форматирование меняет whitespace, сохраняя исходные лексемы и копируемый документ. */
import {describe, expect, test} from "bun:test"
import formatJson from "@zavx0z/storybook-tech-json-format"

describe.each([
  {name: "Объект и пустые коллекции", props: '{"nested":{"ok":true},"array":[],"empty":{}}', expected: '{\n  "nested": {\n    "ok": true\n  },\n  "array": [],\n  "empty": {}\n}', language: "json"},
  {name: "Большое число и повторные ключи", props: '{"id":9007199254740993,"same":1,"same":2,"value":1.00e+2,"zero":-0}', expected: '{\n  "id": 9007199254740993,\n  "same": 1,\n  "same": 2,\n  "value": 1.00e+2,\n  "zero": -0\n}', language: "json"},
  {name: "Строковые escapes", props: String.raw`{"text":"Первый\nВторой\r\nТретий\rЧетвёртый","literal":"\\n","quotes":"\"{}[],\":\\"}`, expected: String.raw`{
  "text": "Первый\nВторой\r\nТретий\rЧетвёртый",
  "literal": "\\n",
  "quotes": "\"{}[],\":\\"
}`, language: "json"},
  {name: "Невалидный plain source", props: "Не JSON: C:\\new\nПолный исходник", expected: "Не JSON: C:\\new\nПолный исходник", language: "plaintext"},
])("$name", ({props, expected, language}) => {
  const result = formatJson(props)
  test("Язык", () => {
    expect(result.languageId, "Подсветка следует валидности полного source").toBe(language)
  })
  test("Сохранение лексем", () => {
    expect(result.text,
      "Форматирование не превращает большие числа и повторные ключи в JS-объект").toBe(expected)
  })
  test("Повторное чтение", () => {
    expect(formatJson(result.text), "Уже форматированный source и позиции переносов остаются стабильными").toEqual(result)
  })
})
