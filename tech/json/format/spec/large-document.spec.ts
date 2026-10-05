import {expect, test} from "bun:test"
import formatJson from "@zavx0z/storybook-tech-json-format"

test("форматирование сохраняет полный большой документ и конечную запись", () => {
  const source = '{"rows":[' + Array.from({length: 4000}, (_, index) => `{"id":${index},"source":"Строка ${index}\\nПродолжение"}`).join(",") + '],"tail":"ПОЛНЫЙ КОНЕЦ"}'
  const result = formatJson(source)
  expect(JSON.parse(result.text)).toEqual(JSON.parse(source))
  expect(result.text.endsWith('"tail": "ПОЛНЫЙ КОНЕЦ"\n}')).toBeTrue()
  expect(result.softBreaks).toHaveLength(4000)
  expect(formatJson(result.text)).toEqual(result)
})
