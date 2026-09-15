import {afterAll, describe, expect, test} from "bun:test"
import {evaluate as run} from "@fixture/function-preview"

describe.each([
  {name: "Ноль", props: {value: 0}},
  {name: "Ложь", props: {value: false}},
  {name: "Пустая строка", props: {value: ""}},
  {name: "Пустой массив", props: {value: []}},
  {name: "Пустой объект", props: {value: {}}},
  {name: "Не задано", props: {}},
  {name: "Специальное число", props: {special: true}},
  {name: "Ошибка", props: {fail: true}},
])("$name", async ({props}) => {
  let first: unknown
  try {
    first = (afterAll(() => run({value: "Очистка"})), await run(props))
  } catch (error) {
    first = error
  }
  const second = await run({value: null})

  test("Первый вызов", () => {
    expect(first instanceof Error, "Отказ различается с возвращёнными данными").toBe("fail" in props)
  })
  test("Второй вызов", () => {
    expect(second, "Независимый результат второго обращения").toBeNull()
  })
})
