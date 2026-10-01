import {describe, expect, test} from "bun:test"
import {evaluate as run, sampleValue} from "@fixture/function-preview"

describe.each([
  {name: "Ноль", props: {value: 0}},
  {name: "Ложь", props: {value: false}},
  {name: "Пустая строка", props: {value: ""}},
  {name: "Пустой массив", props: {value: []}},
  {name: "Пустой объект", props: {value: {}}},
  {name: "Не задано", props: {}},
  {name: "Специальное число", props: {special: true}},
  {name: "Null", props: {value: null}},
  {name: "Вложенный undefined", props: {value: {children: [{}, {slot: ""}, {slot: undefined}], values: [undefined, null]}}},
  {name: "Импортированная функция", props: {value: sampleValue}},
  {name: "Ошибка", props: {fail: true}},
])("$name", async ({props}) => {
  let first: unknown
  try {
    first = await run(props)
  } catch (error) {
    first = error
  }

  test("Первый вызов", () => {
    expect(first instanceof Error, "Отказ различается с возвращёнными данными").toBe("fail" in props)
  })

})
