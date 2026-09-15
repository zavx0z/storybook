import {describe, expect, test} from "bun:test"
import {summarizeNumbers} from ".."

describe.each([
  {name: "Несколько чисел", props: {values: [2, 3]}, expected: {count: 2, sum: 5}},
  {name: "Пустой набор", props: {values: []}, expected: {count: 0, sum: 0}},
])("$name", ({props, expected}) => {
  const result = summarizeNumbers(props)

  test("Состав результата", () => {
    expect(result, "Исходные числа, количество элементов и сумма набора").toEqual({
      values: expect.any(Array), count: expect.any(Number), sum: expect.any(Number),
    })
  })

  describe("Итог", () => {
    test("Количество", () => {
      expect(result.count, "Количество чисел, участвующих в вычислении").toBe(expected.count)
    })
    test("Сумма", () => {
      expect(result.sum, "Сумма переданных чисел, включая ноль для пустого набора").toBe(expected.sum)
      expect(Number.isFinite(result.sum), "Конечное числовое значение суммы").toBeTrue()
    })
  })

  describe("Числа", () => {
    test("Набор", () => {
      expect(result.values, "Числа в исходном порядке, включая пустой массив").toEqual(props.values)
    })
    test.each(result.values.map((value, index) => ({name: `Число ${index + 1}`, value})))("$name", ({value}) => {
      expect(Number.isFinite(value), "Конечное число в составе результата").toBeTrue()
    })
  })
})
