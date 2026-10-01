import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import {Badge as Content} from "@fixture/scenario-component"
import {Container} from "@fixture/scenario-component"

describe.each([
  {name: "label", props: {label: "Подпись", children: null}},
  {name: "children", props: {label: null, children: <Content label="Дочерний компонент" />}},
])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const element = await headless.render(
    <Container label={props.label}>
      {props.children}
    </Container>,
  )

  describe("Контент", () => {
    test("Передача", () => {
      expect(element.textContent, "Показывается переданная подпись либо настоящий дочерний компонент").toBe(props.label ?? "Дочерний компонент")
    })
  })
})
