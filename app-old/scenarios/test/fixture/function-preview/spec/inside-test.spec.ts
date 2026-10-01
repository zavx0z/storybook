import {describe, expect, test} from "bun:test"
import {evaluate as run} from "@fixture/function-preview"

describe.each([{name: "Повторение внутри test", props: {value: 7}}])("$name", async ({props}) => {
  const result = await run(props)
  test("Результат", async () => {
    expect(await run(props), "Повторение скрыто в проверке").toBe(result)
  })
})
