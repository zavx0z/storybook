import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {Command} from "@fixture/scenario-component"

describe.each([
  {name: "Значение вне JSON", props: {label: "Продолжить", disabled: false, metadata: undefined}},
])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  const result = await headless.render(<Command label={props.label} disabled={props.disabled} />)

  test("Команда выполнена", () => {
    expect(result.textContent, "Поддержка fixture не подменяет фактическое выполнение компонента").toBe(props.label)
  })
})
