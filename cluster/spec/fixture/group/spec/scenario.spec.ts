/** Общие гарантии группы проверяются на её публичной операции. */
import {describe, expect, test} from "bun:test"
import {Increment, type FixtureGroup} from "@fixture/group"

describe.each([{name: "Общий вход", props: {value: 3}}])("$name", ({props}) => {
  const input: FixtureGroup.Input = Object.freeze(props)
  const output: FixtureGroup.Output = Increment(input)
  test("Общее соглашение", () => {
    expect(output, "Операция возвращает число и использует общий вход").toBe(4)
    expect(input, "Общий вход сохраняется неизменным").toEqual({value: 3})
  })
})
