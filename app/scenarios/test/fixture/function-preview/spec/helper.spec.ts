import {describe, expect, test} from "bun:test"
import {evaluate as run, sampleValue} from "@fixture/function-preview"

describe.each([{name: "Один вызов и помощник", props: {value: 7}}])("$name", async ({props}) => {
  const result = await run(props)
  test("Результат", () => {
    expect(result, "Описываемая функция вызвана один раз").toBe(7)
    expect(sampleValue(), "Вызов другой функции не считается повторением описываемой").toBe("sample")
  })
})
