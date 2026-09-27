import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import {ChildrenFixture} from "./fixture/children"

describe.each([{name: "Без дочернего элемента", props: {label: "Подпись"}}])("$name", async ({props}) => {
  const headless = createHeadless({width: 320, height: 160})
  afterAll(() => headless.dispose())
  const element = await headless.render(ChildrenFixture, props)
  test("Содержимое", () => {
    expect(element.textContent, "Необязательный children отсутствует, а подпись сохраняется").toBe(props.label)
  })
})
