import {afterAll, describe, expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {Command} from "@fixture/scenario-component"

describe.each([
  {name: "Команда со состоянием", props: {label: "Продолжить", disabled: false}},
])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 160})
  afterAll(() => headless.dispose())
  // @ts-expect-error Проверка нарушенной формы вызова.
  const element = await headless.render(Command, props)

  await headless.renderComponent(Command, props)

  test("Начальное состояние", () => {
    expect(element.textContent, "Публичный компонент получает подпись, а пример показывает исходное состояние счётчика").toBe("Продолжить")
  })
})
