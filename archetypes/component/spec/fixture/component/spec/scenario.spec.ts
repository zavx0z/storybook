import {describe, expect, test} from "bun:test"
import {increment} from "@fixture/archetype-component"

describe.each([{name: "Увеличение", props: {value: 1}}])("$name", ({props}) => {
  const result = increment(props)
  test("Новое значение", () => {
    expect(result, "Число увеличено на единицу").toBe(2)
  })
})
