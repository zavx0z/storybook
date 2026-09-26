import {describe as group, it as item, expect as check} from "bun:test"

group.each([{name: "Один"}, {name: "Два"}])("$name", () => {
  item.each([{name: "Первый", value: 1}, {name: "Второй", value: 2}])("$name", ({value}) => check(value, "Значение строки таблицы").toBeGreaterThan(0))
  item("Callback завершения", done => {
    queueMicrotask(() => {
      check(true, "Завершение асинхронной операции").toBeTrue()
      done()
    })
  })
})
