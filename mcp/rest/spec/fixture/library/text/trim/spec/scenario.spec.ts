import {describe, expect, test} from "bun:test"
import {trimText} from "@fixture/lazy-content/text/trim"

describe.each([
  {name: "Текст с отступами", props: "  два слова  ", expected: "два слова"},
  {name: "Одни пробелы", props: "   ", expected: ""},
])("$name", ({props, expected}) => {
  const result = trimText(props)

  test("Содержимое", () => {
    expect(result, "Пробелы по краям удалены, содержимое текста сохранено").toBe(expected)
  })
})
