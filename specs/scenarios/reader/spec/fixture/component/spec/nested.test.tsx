import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import {Badge as Content} from "@fixture/scenario-component"
import {Container} from "@fixture/scenario-component"

describe.each([
  {name: "label", props: {label: "Подпись", children: null}},
  {name: "children", props: {label: null, children: <Content label="Дочерний компонент" />}},
])("$name", ({props: content}) => {
  describe.each([
    {name: "Слева", props: {...content, side: "left"}},
    {name: "Справа", props: {...content, side: "right"}},
  ])("$name", async ({props}) => {
    const headless = createHeadless({width: 400, height: 160})
    afterAll(() => headless.dispose())
    const element = await headless.render(
    <Container label={props.label}>
      {props.children}
    </Container>,
  )

    test("Контент", () => {
      expect(element.textContent, "Вложенный вариант получает контент своей внешней строки").toBe(props.label ?? "Дочерний компонент")
      expect(props.side, "Вложенная таблица задаёт сторону примера").toMatch(/^(left|right)$/)
    })
  })
})
