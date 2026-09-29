import {describe, expect, test} from "bun:test"
import {increment} from "@fixture/archetype-domain/counter"

describe.each([{name: "Публичная операция области", props: {value: 2}}])("$name", ({props}) => {
  const result = increment(props)
  test("Правило увеличения", () => {
    expect(result, "Публичный путь области сохраняет поведение компонента").toBe(3)
  })
})
