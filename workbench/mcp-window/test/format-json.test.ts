import {expect, test} from "bun:test"
import {formatJson} from "../src/format-json"

test("переносы отделяются от буквального обратного слеша в JSON", () => {
  const value = {description: "Первая\nВторая\r\nТретья\rЧетвёртая", path: "C:\\new\\repo", literal: "\\n"}
  const formatted = formatJson(JSON.stringify(value))
  expect(JSON.parse(formatted.text)).toEqual(value)
  expect(formatted.softBreaks).toHaveLength(3)
  expect(formatted.softBreaks.map(offset => formatted.text.slice(offset, offset + 6))).toEqual(["Вторая", "Третья", "Четвёр"])
  expect(formatJson("Не JSON: C:\\new")).toEqual({text: "Не JSON: C:\\new", softBreaks: []})
})
