import {describe, expect, test} from "bun:test"
import ConstructedValue from "@fixture/default-class"

describe.each([
  {name: "Один конструктор", props: {value: 7}},
])("$name", ({props}) => {
  const instance = new ConstructedValue(props.value)

  test("Результат и побочный эффект", () => {
    expect(instance.value, "Результат получен из созданного экземпляра").toBe(props.value)
    expect(ConstructedValue.constructions, "Конструктор выполнен один раз для выбранного варианта").toBe(1)
  })
})
