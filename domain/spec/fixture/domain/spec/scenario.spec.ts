/** Связь общего значения и двух средовых обязанностей счётчика. */
import {describe, expect, test} from "bun:test"
import advanceCounter from "../server"
import showCounter from "../web"

describe.each([{name: "Изменённое значение", props: {counter: {value: 2}, step: 3}}])("$name", ({props}) => {
  const result = advanceCounter(props)
  test("Изменение", () => {
    expect(result, "Сервер возвращает следующий снимок общей сущности").toEqual({value: 5})
    expect(props.counter, "Предыдущий снимок сохраняется").toEqual({value: 2})
  })
  test("Представление", () => {
    expect(showCounter({counter: result, prefix: "Счётчик: "}), "Представление читает тот же результат без собственного состояния")
      .toBe("Счётчик: 5")
  })
})
