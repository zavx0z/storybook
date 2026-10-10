import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import {Container} from "@fixture/scenario-component"

describe.each([{name: "Без дочернего элемента", props: {label: "Подпись"} as {label: string; children?: undefined}}])("$name", async ({props}) => {
  const headless = createHeadless({width: 320, height: 160})
  afterAll(() => headless.dispose())
  const element = await headless.render(
    <Container label={props.label}>
      {props.children}
    </Container>,
  )
  test("Содержимое", () => {
    expect(element.textContent, "Необязательный children отсутствует, а подпись сохраняется").toBe(props.label)
  })
})
