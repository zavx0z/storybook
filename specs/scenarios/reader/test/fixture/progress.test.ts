import {describe, expect, test} from "bun:test"

describe.each([{name: "Поток вывода", props: {value: "Привет 🌍"}}])("$name", ({props}) => {
  test("Первая проверка", async () => {
    console.log(props.value)
    await Bun.sleep(50)
    expect(props.value, "Текст варианта не изменён").toBe("Привет 🌍")
  })
  test("Вторая проверка", () => {
    console.error("Диагностика теста")
    expect(true, "Второй пункт выполнен").toBeTrue()
  })
})
