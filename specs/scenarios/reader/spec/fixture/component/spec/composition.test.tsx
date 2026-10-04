import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {Command, Badge as Content} from "@fixture/scenario-component"
import {SlotPanel} from "../../slots"
import {commandProps} from "./fixture/props"

describe.each([{name: "Композиция", props: commandProps}])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const element = await headless.render(
    <SlotPanel label={props.label}>
      <Command label={props.label} disabled={props.disabled} />
      <Content slot="header" label="Содержимое" />
    </SlotPanel>,
  )
  test("Текст", () => {
    expect(element.textContent, "Состав примера раскрыт в JSX, фикстура предоставляет только данные").toBe(`Содержимое${props.label}`)
  })
})
