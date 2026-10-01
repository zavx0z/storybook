import {describe, expect, test} from "bun:test"
import First from "@fixture/default-class"
import Second from "@fixture/default-class"

describe.each([
  {name: "Два локальных имени", props: {value: 7}},
])("$name", ({props}) => {
  const first = new First(props.value)
  new Second(props.value + 1)

  test("Оба имени относятся к публичному default", () => {
    expect(first.value, "Первый результат принадлежит прямому конструированию").toBe(props.value)
    expect(First.constructions, "Оба имени вызвали один и тот же публичный класс").toBe(2)
  })
})
