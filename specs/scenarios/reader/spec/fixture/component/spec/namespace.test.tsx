import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import * as Components from "@fixture/scenario-component"

describe.each([{name: "Namespace", props: {label: "Текст", disabled: false}}])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const element = await headless.render(<Components.Command label={props.label} disabled={props.disabled} />)
  test("Текст", () => {
    expect(element.textContent, "Публичный namespace сохраняет происхождение компонента").toBe(props.label)
  })
})
