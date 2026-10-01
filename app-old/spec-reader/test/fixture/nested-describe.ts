import {describe as group, test} from "bun:test"

group.each([{name: "Вариант"}])("$name", () => {
  group("Категория", () => {
    group.skipIf(false)("Подкатегория", () => {
      test("Пункт", () => {})
    })
  })
})

group("Внешняя группа без вариантов", () => {
  group("Её категория", () => {})
})
