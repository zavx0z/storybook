import {describe, expect, test} from "bun:test"
import labelAction from "@fixture/storybook-action"

describe.each([
  {name: "Основное действие", props: {name: "Open"}, expected: "Action: Open"},
  {name: "Другое действие", props: {name: "Close"}, expected: "Action: Close"},
])("$name", ({props, expected}) => {
  const result = labelAction(props)

  test("Подпись действия", () => {
    expect(result, "Публичная функция строит подпись из переданного имени")
      .toBe(expected)
  })
})
