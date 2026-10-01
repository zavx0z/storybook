import {describe, expect, test} from "bun:test"
import double from "@fixture/default-assigned"

describe.each([
  {name: "Два прямых вызова", props: {value: 7}},
])("$name", ({props}) => {
  const first = double(props)
  double({value: props.value + 1})

  test("Исход первого вызова", () => {
    expect(first.value, "Первый вызов возвращает значение, но вариант нарушает однократность").toBe(14)
  })
})
