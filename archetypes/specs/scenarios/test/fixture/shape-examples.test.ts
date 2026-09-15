import {beforeAll, describe, expect, test} from "bun:test"

describe.each([{name: "Формы"}])("$name", () => {
  const value = 1
  beforeAll(() => {})
  test("Число", () => { expect(value, "Числовое значение").toEqual(1) })
  test("Массив", () => { expect([value], "Массив значений").toEqual([1]) })
  test("Явный объект", () => { expect({value}, "Полный состав объекта").toEqual({value: 1}) })
  test("Spread", () => { expect({value}, "Состав из другого объекта").toEqual({...{value: 1}}) })
  test("Вычисляемое поле", () => { expect({value} as Record<string, number>, "Динамический ключ").toEqual({[String("value")]: 1}) })
  test("Литеральное поле", () => { expect({value}, "Явный ключ").toEqual({["value"]: 1}) })
})
