import {describe, expect, test} from "bun:test"
import readDomainMcp from "@zavx0z/storybook-domain-mcp"

describe.each([
  {name: "Domain в проекте", props: {path: "example/domain"}},
  {name: "Другой Domain", props: {path: "another/domain"}},
])("$name", ({props}) => {
  const result = readDomainMcp(props)

  test("Предметный вход", () => {
    expect(result, "Выбранный адрес сохраняется; отсутствие реализации Domain MCP выражено явно")
      .toEqual({
        path: props.path,
        status: "not-implemented",
        description: "Предметный MCP для Domain ещё не реализован.",
      })
  })
})
