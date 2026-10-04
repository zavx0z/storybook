import {describe, expect, test} from "bun:test"
import readRepoMcp from "@storybook-repo/mcp"

describe.each([
  {name: "Repo в проекте", props: {path: "example/repo"}},
  {name: "Другой Repo", props: {path: "another/repo"}},
])("$name", ({props}) => {
  const result = readRepoMcp(props)

  test("Предметный вход", () => {
    expect(result, "Выбранный адрес сохраняется; отсутствие реализации Repo MCP выражено явно")
      .toEqual({
        path: props.path,
        status: "not-implemented",
        description: "Предметный MCP для Repo ещё не реализован.",
      })
  })
})
