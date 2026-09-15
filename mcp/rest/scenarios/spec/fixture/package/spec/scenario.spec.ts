import {describe, expect, test} from "bun:test"

describe.each([{name: "Обычный", props: {value: 7}}, {name: "Пустой", props: {value: null}}])("$name", ({props}) => {
  const result = {value: props.value, text: "", list: []}
  test("Значение", () => {
    expect(result.value, "Значение выбранного варианта").toBe(props.value)
  })
  describe("Данные", () => {
    test("Состав", () => {
      expect(result.text, "Текст выбранного варианта").toBe("")
      expect(result.list, "Коллекция выбранного варианта").toEqual([])
    })
    describe("Проверки", () => {
      /** @remarks Вариант не использует внешнюю службу. */
      test.skip("Внешняя служба", () => {
        expect(result.value, "Ответ внешней службы").toBeDefined()
      })
      test.todo("Дополнение", () => {
        expect(result.value, "Незавершённое требование").toBeDefined()
      })
      test.failing("Несоответствие", () => {
        expect(result.text, "Непустой текст результата").not.toBe("")
        expect(result.list, "Проверка после прерывания").toEqual([])
      })
    })
  })
})
