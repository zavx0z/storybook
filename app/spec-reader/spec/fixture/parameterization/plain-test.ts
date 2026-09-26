import {describe, test} from "bun:test"

describe.each([{name: "Группа"}])("$name", () => {
  test("Обычный тест", () => {})
})
