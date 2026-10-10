import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import {Command} from "@fixture/scenario-component"

describe.each([{name: "Затенение", props: {label: "Текст"}}])("$name", async ({props}) => {
  const Command = (input: {label: string}) => <button>{input.label}</button>
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const element = await headless.render(<Command label={props.label} />)
  test("Текст", () => {
    expect(element.textContent, "Совпадение имени импорта не превращает локальную обёртку в публичный компонент").toBe(props.label)
  })
})
