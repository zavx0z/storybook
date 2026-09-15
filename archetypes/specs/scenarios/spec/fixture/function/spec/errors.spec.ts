import {describe, expect, test} from "bun:test"
import {summarizeNumbers} from ".."

describe.each([
  {name: "Бесконечность", props: {values: [Infinity]}},
  {name: "Не число", props: {values: [NaN]}},
])("$name", ({props}) => {
  test("Недопустимый вход", () => {
    expect(() => summarizeNumbers(props), "Отказ от вычисления с неконечными числами").toThrow("Ожидаются конечные числа")
  })
})
