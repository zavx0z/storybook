/** Escape-переносы проверяются собственными вариантами без зависимости от conditional skip другой группы. */
import {describe, expect, test} from "bun:test"
import formatJson from "@zavx0z/storybook-tech-json-format"

describe.each([
  {name: "LF, CRLF и CR", props: String.raw`{"text":"First\nSecond\r\nThird!\rFourth","literal":"\\n","quotes":"\"{}[],\":\\"}`, expected: ["Second", "Third!", "Fourth"]},
  {name: "Unicode escape после LF", props: String.raw`{"text":"\u0412\n\u0411"}`, expected: [String.raw`\u0411`]},
  {name: "Буквальный backslash", props: String.raw`{"path":"C:\\new\\repo","literal":"\\n"}`, expected: []},
])("$name", ({props, expected}) => {
  const result = formatJson(props)
  test("Визуальные переносы", () => {
    expect(result.softBreaks.map(offset => result.text.slice(offset, offset + 6)),
      "LF/CRLF/CR дают переносы, а экранированный backslash остаётся исходным текстом").toEqual([...expected])
  })
  test("Копируемый текст", () => {
    expect(JSON.parse(result.text), "Подсказки для readonly представления не удаляют escape-символы из полного документа").toEqual(JSON.parse(props))
  })
})
