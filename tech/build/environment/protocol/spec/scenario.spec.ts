/** Версия протокола общей browser identity передаётся без файлового доступа. */
import {describe, expect, test} from "bun:test"
import Protocol from "@build-environment/protocol"

describe.each([
  {name: "Общая среда Storybook", props: {expected: "storybook-shared-browser-identity/1"}},
])("$name", ({props}) => {
  const actual = Protocol
  test("Идентификатор формата", () => {
    expect(actual, "Producer и consumer используют одну точную версию формата browser identity").toBe(props.expected)
  })
})
