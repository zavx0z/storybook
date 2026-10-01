/**
Показывает результат публичного числового преобразования.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import adjust from "../index.ts"

describe.each([{name: "Числовой пример", props: 2}])("$name", ({props}) => {
  const result = adjust(props)
  test("Результат преобразования", () => {
    expect(result, "Выход выражает результат полного преобразования выбранного владельца").toBe(3)
  })
})
