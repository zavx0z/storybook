import {describe, expect, test} from "bun:test"

describe.each([{name: "Первый", value: 1}, {name: "Второй", value: 2}])("$name", ({value}: {value: number}) => {
  test("Значения", () => {
    expect(null, "Отсутствующее значение результата").toBeNull()
    expect("", "Пустой текст результата").toBe("")
    expect([], "Пустая коллекция результата").toEqual([])
  })
  test("Асимметричные условия", () => {
    expect({number: value, text: "value"}, "Состав и типы результата").toEqual({number: expect.any(Number), text: expect.any(String)})
  })
  describe("Число", () => {
    test("Повторное утверждение", () => {
      const assertion = expect(value, "Положительное значение варианта")
      assertion.toBeGreaterThan(0)
      assertion.not.toBe(0)
    })
    test("Асинхронное значение", async () => {
      await expect(Promise.resolve(value), "Результат завершённого вычисления").resolves.toBe(value)
    })
    test.each([{name: "Один", n: 1}, {name: "Два", n: 2}])("$name", ({n}) => {
      expect(n, "Числовой параметр пункта").toBeGreaterThan(0)
    })
    /** @remarks Число этого варианта не требует специальной проверки. */
    test.skipIf(value > 0)("Пропуск", () => {
      expect(value, "Неприменимая проверка").toBe(0)
    })
    test.todo("Позже", () => {
      expect(value, "Незавершённое требование").toBe(0)
    })
    test.failing("Ожидаемое падение", () => {
      expect(value, "Отрицательный пример").toBe(0)
    })
  })
})

/** @remarks Ошибки включаются только внешним тестом инспектора. */
describe.skipIf(!process.env.TRACE_ASSERTIONS_FAILURE)("Ошибки", () => {
  test("Прерывание", () => {
    expect(1, "Первое требование").toBe(2)
    expect(3, "Недостигнутое требование").toBe(3)
  })
  test("Число утверждений", () => {
    expect.assertions(2)
    expect(1, "Единственное достигнутое утверждение").toBe(1)
  })
})
