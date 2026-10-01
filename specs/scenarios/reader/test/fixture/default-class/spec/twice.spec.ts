import {describe, expect, test} from "bun:test"
import ConstructedValue from "@fixture/default-class"

describe.each([
  {name: "Два конструктора", props: {value: 7}},
])("$name", ({props}) => {
  const first = new ConstructedValue(props.value)
  new ConstructedValue(props.value + 1)

  test("Два настоящих вызова", () => {
    expect(first.value, "Первый результат сохранён без подмены").toBe(props.value)
    expect(ConstructedValue.constructions, "Сценарий исполнил оба вызова для диагностики оформления").toBe(2)
  })
})
