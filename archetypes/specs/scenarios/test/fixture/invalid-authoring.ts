import {describe as group, expect, test} from "bun:test"

const message = "Вынесенное описание"
group("Без параметризации", () => {
  test("Нет описания", () => { expect(1).toBe(1) })
  test("Вынесенное описание", () => { expect(1, message).toBe(1) })
  test("Пустой тест", () => {})
  test.todo("Черновик", () => {})
  test.skip("Без пояснения", () => { expect(1, "Значение").toBe(1) })
})

export function hiddenTest() {
  test("Спрятанный тест", () => { expect(1, "Значение").toBe(1) })
}
