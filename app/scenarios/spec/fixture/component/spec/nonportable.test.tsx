import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import {CommandFixture} from "./fixture"

describe.each([
  {name: "Значение вне JSON", props: {label: "Продолжить", disabled: false, metadata: undefined}},
])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const result = await headless.render(CommandFixture, props)

  test("Команда выполнена", () => {
    expect(result.textContent, "Поддержка fixture не подменяет фактическое выполнение компонента").toBe(props.label)
  })
})
