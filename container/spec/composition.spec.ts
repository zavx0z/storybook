/**
Проверяет наблюдаемый результат вложенной композиции через её публичный вход.
Порядок вызовов различим: сначала увеличение, затем удвоение.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import compose from "./fixture/compose/index.ts"

describe.each([
  {name: "Положительное число", props: 2, expected: 6},
  {name: "Нулевое число", props: 0, expected: 2},
  {name: "Отрицательное число", props: -3, expected: -4},
])("$name", ({props, expected}) => {
  const result = compose(props)
  test("Результат целого", () => {
    expect(result,
      "Вложенный контейнер увеличивает число, следующий компонент удваивает его результат; перестановка частей дала бы другое значение")
      .toBe(expected)
  })
})
