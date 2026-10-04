import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {ChildrenFixture as Example} from "./fixture/children"

describe.each([{name: "Обёртка", props: {label: "Текст"}}])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const element = await headless.render(<Example label={props.label} />)
  test("Текст", () => {
    expect(element.textContent, "Успешный результат обёртки не заменяет прямое использование компонента").toBe(props.label)
  })
})
