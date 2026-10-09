import {describe, expect, test} from "bun:test"
import label from "@zavx0z/storybook-package-build-conformance-spec-fixture-component"

describe.each([
  {name: "Подпись кнопки", props: {name: "Button"}, expected: "Label: Button"},
  {name: "Подпись поля", props: {name: "Input"}, expected: "Label: Input"},
])("$name", ({props, expected}) => {
  const result = label(props)

  test("Авторская подпись", () => {
    expect(result, "Компонент сохраняет переданное имя в публичном результате")
      .toBe(expected)
  })
})
