import {describe, expect, test} from "bun:test"
import readContainerMcp from "@zavx0z/storybook-container-mcp"

describe.each([
  {name: "Container в проекте", props: {path: "example/container"}},
  {name: "Другой Container", props: {path: "another/container"}},
])("$name", ({props}) => {
  const result = readContainerMcp(props)

  test("Предметный вход", () => {
    expect(result, "Выбранный адрес сохраняется; отсутствие реализации Container MCP выражено явно")
      .toEqual({
        path: props.path,
        status: "not-implemented",
        description: "Предметный MCP для Container ещё не реализован.",
      })
  })
})
