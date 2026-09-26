import {afterAll, describe as suite, expect, test} from "bun:test"

const declared = [
  {name: "Первый", props: {path: "first", keep: 1, settings: {original: true}, text: ""}},
  {name: "Второй", props: {path: "second", keep: 2, settings: {original: true}, text: ""}},
]

suite.each(declared)("$name", async ({props: input}) => {
  await Promise.resolve()
  test("Параметры", () => {
    expect(input, "Фактические параметры зарегистрированного варианта").toBeDefined()
  })
  suite.each([{name: "Вложенный", props: {path: "nested"}}])("$name", ({props}) => {
    test("Вложенные параметры", () => {
      expect(props.path, "Вложенная таблица сохраняет собственные параметры").toBe("nested")
    })
  })
  test.each([{props: {path: "test"}}])("Параметры пункта", ({props}) => {
    expect(props.path, "Таблица test.each сохраняет собственные параметры").toBe("test")
  })
})

afterAll(() => {
  expect(declared.map(row => row.props.path), "Объявленная таблица не изменяется подстановкой").toEqual(["first", "second"])
})
