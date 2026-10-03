import {describe, expect, test} from "bun:test"
import run from "../index"

describe.each([
  {name: "Увеличение числа", props: {value: 2}},
])("$name", ({props}) => {
  const result = run(props)

  test("Результат", () => {
    expect(result, "Функция возвращает следующее целое число").toBe(3)
  })
})
