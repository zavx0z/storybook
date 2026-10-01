import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import {StatefulCommand} from "@fixture/scenario-component"

describe.each([
  {name: "Команда со состоянием", props: {label: "Продолжить", disabled: false}},
])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const element = await headless.render(
    <StatefulCommand
      label={props.label}
      disabled={props.disabled}
    />,
  )

  test("Начальное состояние", () => {
    expect(element.textContent, "Публичный компонент получает подпись, а пример показывает исходное состояние счётчика").toBe("Продолжить0")
  })
})
