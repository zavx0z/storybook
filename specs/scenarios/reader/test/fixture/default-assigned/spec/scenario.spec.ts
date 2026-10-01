import {describe, expect, test} from "bun:test"
import double from "@fixture/default-assigned"

describe.each([
  {name: "Удвоение", props: {value: 7}},
])("$name", ({props}) => {
  const result = double(props)

  test("Значение", () => {
    expect(result.value, "Публичная функция возвращает удвоенное значение").toBe(14)
  })
  test("Единицы", () => {
    expect(double.unit, "Статическое описание результата доступно у той же публичной функции").toBe("points")
  })
})
