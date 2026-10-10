import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import {Container} from "@fixture/scenario-component"
import {Content} from "./fixture/children"

describe.each([{name: "Скрытое содержимое", props: {label: "Текст"}, slots: {default: <Content />}}])("$name", async ({props, slots}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const element = await headless.render(<Container label={props.label}>{slots.default}</Container>)
  test("Текст", () => {
    expect(element.textContent, "Обёртка не скрывает состав содержимого слота").toContain(props.label)
  })
})
