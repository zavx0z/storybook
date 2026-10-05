/** История читается одинаково для текста и мультимодального содержимого. */
import {describe, expect, test} from "bun:test"
import readHistory from "@zavx0z/storybook-chat-history"

describe.each([
  {name: "Текст", props: [{id: "text", sequence: 1, origin: "local", kind: "message", role: "user", content: [{type: "text", text: "Вопрос"}]}]},
  {name: "Изображение", props: [{id: "image", sequence: 1, origin: "live", kind: "message", role: "assistant", content: [{type: "image", data: "AA==", mimeType: "image/png"}]}]},
])("$name", ({props}) => {
  const actual = readHistory(props)
  test("Содержимое", () => {
    expect(actual, "Reader сохраняет переданные блоки содержимого и порядок записей").toEqual(props)
  })
  test("Независимость", () => {
    expect(actual, "Возвращённая история не разделяет изменяемый массив с вызывающим кодом").not.toBe(props)
  })
})
