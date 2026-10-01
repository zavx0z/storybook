import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import type {HTMLButtonElement} from "@zavx0z/dom"
import {Command} from "@fixture/scenario-component"

describe.each([
  {name: "Доступная команда", props: {label: "Продолжить", disabled: false}, expected: [["Продолжить"]]},
  {name: "Недоступная команда", props: {label: "Продолжить", disabled: true}, expected: []},
])("$name", async ({props: input, expected}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const props = {...input, onActivate: mock<(label: string) => void>()}
  const result = await headless.render(
    <Command
      label={props.label}
      disabled={props.disabled}
      onActivate={props.onActivate}
    />,
  )

  test("Состав представления", () => {
    expect({tag: result.localName, text: result.textContent, disabled: result.hasAttribute("disabled")}, "Кнопка с подписью и состоянием доступности").toEqual({
      tag: "button", text: input.label, disabled: input.disabled,
    })
  })

  describe("Использование", () => {
    test("Подпись", () => {
      expect(result.textContent, "Название действия, переданное в компонент").toBe(input.label)
    })
    test("Доступность", () => {
      expect(result.hasAttribute("disabled"), "Доступность действия в выбранном варианте").toBe(input.disabled)
    })
    test("Тип действия", () => {
      expect(result.getAttribute("type"), "Команда без неявной отправки формы").toBe("button")
    })
    test("Обратный вызов", () => {
      const button = result as HTMLButtonElement
      button.click()
      expect<readonly unknown[]>(props.onActivate.mock.calls,
        "Доступная команда один раз передаёт подпись в callback; недоступная не вызывает его").toEqual(expected)
    })
  })
})
