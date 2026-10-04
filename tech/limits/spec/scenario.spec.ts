/** Бюджеты транспорта не ограничивают длительность сборки или сценария. */
import {describe, expect, test} from "bun:test"
import Limits from "@zavx0z/storybook-tech-limits"

describe.each([
  {name: "HTTP без данных", props: {budget: Limits.STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS, expected: 125}},
])("$name", ({props}) => {
  const actual = props.budget
  test("Единицы транспорта", () => {
    expect(actual, "HTTP idle timeout задан в секундах и не является сроком сборки").toBe(props.expected)
  })
})
