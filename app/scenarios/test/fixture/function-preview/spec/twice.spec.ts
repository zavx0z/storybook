import {describe, expect, test} from "bun:test"
import {evaluate as run} from "@fixture/function-preview"

describe.each([{name: "Повторная подготовка", props: {value: 7}}])("$name", async ({props}) => {
  const result = await run(props)
  await run(props)
  test("Результат", () => {
    expect(result, "Обычная проверка результата проходит, но повторный вызов нарушает сценарий").toBe(7)
  })
})
