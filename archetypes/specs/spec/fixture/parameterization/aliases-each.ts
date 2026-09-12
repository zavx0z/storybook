import {describe as group, test as check} from "bun:test"

group.each([{name: "Пример"}])("$name", () => {
  check("Обычная проверка", () => {})
})
