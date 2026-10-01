import {describe, test} from "bun:test"

/** Образец объявлений для статической проверки; при чтении фикстуры функция не вызывается. */
export function defineScenarios() {
  describe.each([{name: "Пример"}])("$name", () => {
    test("Обычный тест внутри параметризованной группы", () => {})
  })
}
