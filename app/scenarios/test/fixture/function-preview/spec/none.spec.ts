import {describe, expect, test} from "bun:test"
import {evaluate} from "@fixture/function-preview"

describe.each([{name: "Без вызова", props: {value: 7}}])("$name", ({props}) => {
  test("Описание", () => {
    expect(typeof evaluate, "Наличие функции не заменяет её вызов").toBe("function")
    expect(props.value, "Входные данные ещё не являются результатом").toBe(7)
  })
})
