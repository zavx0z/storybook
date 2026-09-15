import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import {CommandFixture} from "./fixture"

describe.each([
  {name: "Доступная команда", props: {label: "Продолжить", disabled: false}},
  {name: "Недоступная команда", props: {label: "Продолжить", disabled: true}},
])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const result = await headless.render(CommandFixture, props)

  test("Состав представления", () => {
    expect({tag: result.localName, text: result.textContent, disabled: result.hasAttribute("disabled")}, "Кнопка с подписью и состоянием доступности").toEqual({
      tag: "button", text: props.label, disabled: props.disabled,
    })
  })

  describe("Использование", () => {
    test("Подпись", () => {
      expect(result.textContent, "Название действия, переданное в компонент").toBe(props.label)
    })
    test("Доступность", () => {
      expect(result.hasAttribute("disabled"), "Доступность действия в выбранном варианте").toBe(props.disabled)
    })
    test("Тип действия", () => {
      expect(result.getAttribute("type"), "Команда без неявной отправки формы").toBe("button")
    })
  })
})
