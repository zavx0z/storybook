import {describe as group, test} from "bun:test"

group.skipIf(true).each([{}])("Группа", () => {
  // Обычный комментарий не заменяет @remarks.
  test.skip("Проверка", () => {})
})
