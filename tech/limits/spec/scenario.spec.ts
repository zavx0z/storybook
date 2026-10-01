/** Конечные бюджеты обычной компиляции, общей среды и удержания сервера. */
import {describe, expect, test} from "bun:test"
import Limits from "@tech/limits"

describe.each([
  {name: "Компиляция пакета", props: {budget: Limits.STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS, expected: 120_000}},
  {name: "Компиляция общей среды", props: {budget: Limits.STORYBOOK_SHARED_COMPILE_TIMEOUT_MS, expected: 480_000}},
])("$name", ({props}) => {
  const actual = props.budget

  test("Бюджет в миллисекундах", () => {
    expect(actual, "Предел ожидания компиляции задан в миллисекундах и зависит от объёма работы").toBe(props.expected)
  })

  test("Время удержания управляющего соединения", () => {
    expect(Limits.STORYBOOK_SERVER_IDLE_TIMEOUT_SECONDS * 1_000,
      "Сервер удерживает управляющее соединение дольше обычной компиляции пакета"
    ).toBeGreaterThan(Limits.STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS)
  })
})
