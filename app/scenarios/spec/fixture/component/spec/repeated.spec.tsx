import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import {Command} from "@fixture/scenario-component"

describe.each([{name: "Повторный render", props: {label: "Команда", disabled: false}}])("$name", async ({props}) => {
  const host = createHeadless({width: 320, height: 160})
  afterAll(() => host.dispose())
  const node = await host.render(
    <Command
      label={props.label}
      disabled={props.disabled}
    />,
  )
  test("Сохранение элемента", async () => {
    const updated = await host.render(
      <Command
        label={props.label}
        disabled={props.disabled}
      />,
    )
    expect(updated, "Техническая проверка обновления не становится сценарием одного вызова").toBe(node)
  })
})
