/** Собственный результат участника общего протокола. */
import {describe, expect, test} from "bun:test"
import increment from "@fixture/increment"

describe.each([{name: "Собственный шаг", props: {value: 2, step: 3}}])("$name", ({props}) => {
  const result = increment(props)
  test("Результат", () => {
    expect(result, "Участник применяет дополнительную возможность своего протокола").toBe(5)
    expect(props, "Общий протокол сохраняет исходный объект").toEqual({value: 2, step: 3})
  })
})
