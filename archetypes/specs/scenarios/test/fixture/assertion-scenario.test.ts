import {describe, expect, test} from "bun:test"

describe.each([{name: "Первый", value: 1}, {name: "Второй", value: 2}])("$name", ({value}: {value: number}) => {
  test("Значения", () => {
    expect(null, "Отсутствующее значение результата").toBeNull()
    expect("", "Пустой текст результата").toBe("")
    expect([], "Пустая коллекция результата").toEqual([])
  })
  test("Accessor массива", () => {
    let reads = 0
    const input: unknown[] = []
    Object.defineProperty(input, "0", {
      get() {
        reads++
        return value
      },
    })
    expect(input, "Массив с вычисляемым элементом").toBeArray()
    expect(reads, "Наблюдение за actual не выполняет getter элемента").toBe(0)
  })
  test("Асимметричные условия", () => {
    expect({number: value, text: "value"}, "Состав и типы результата").toEqual({number: expect.any(Number), text: expect.any(String)})
  })
  test("Шаблон", () => {
    expect("VALUE", "Условие сопоставления строки").toMatch(/(?<word>value)/iu)
  })
  test.each([{name: "NaN", value: NaN}, {name: "-0", value: -0}])("$name", ({value}) => {
    expect(value, "Точное специальное числовое значение").toBe(value)
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
    /** @remarks Ноль исключается из этого примера. */
    test.skipIf(value === 0)("Выполненный условный тест", () => {
      expect(value, "Значение применимого примера").toBeGreaterThan(0)
    })
    test.todo("Позже", () => {
      expect(value, "Незавершённое требование").toBe(0)
    })
    test.failing("Ожидаемое падение", () => {
      expect(value, "Отрицательный пример").toBe(0)
    })
  })
})

/** @remarks Родительская группа неприменима. */
describe.skip("Родительский пропуск", () => {
  /** @remarks Собственное условие этого теста не сработало. */
  test.skipIf(false)("Унаследованный пропуск", () => {
    expect(true, "Тело неприменимого теста не выполняется").toBeFalse()
  })
})

describe.each([{name: "Ошибки", props: {failures: false}}])("$name", ({props}) => {
  /** @remarks Ошибки включаются только внешним тестом инспектора. */
  test.skipIf(!props.failures)("Прерывание", () => {
    expect(1, "Первое требование").toBe(2)
    expect(3, "Недостигнутое требование").toBe(3)
  })
  /** @remarks Ошибки включаются только внешним тестом инспектора. */
  test.skipIf(!props.failures)("Число утверждений", () => {
    expect.assertions(2)
    expect(1, "Единственное достигнутое утверждение").toBe(1)
  })
})
