import {describe, expect, test} from "bun:test"
import readComponentMcp from "@zavx0z/storybook-component-mcp"

describe.each([
  {name: "Component в проекте", props: {path: "example/component"}},
  {name: "Другой Component", props: {path: "another/component"}},
])("$name", ({props}) => {
  const result = readComponentMcp(props)

  test("Предметный вход", () => {
    expect(result, "Выбранный адрес сохраняется; отсутствие реализации Component MCP выражено явно")
      .toEqual({
        path: props.path,
        status: "not-implemented",
        description: "Предметный MCP для Component ещё не реализован.",
      })
  })
})
