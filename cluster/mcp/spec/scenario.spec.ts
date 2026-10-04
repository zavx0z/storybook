import {describe, expect, test} from "bun:test"
import readClusterMcp from "@storybook-cluster/mcp"

describe.each([
  {name: "Cluster в проекте", props: {path: "example/cluster"}},
  {name: "Другой Cluster", props: {path: "another/cluster"}},
])("$name", ({props}) => {
  const result = readClusterMcp(props)

  test("Предметный вход", () => {
    expect(result, "Выбранный адрес сохраняется; отсутствие реализации Cluster MCP выражено явно")
      .toEqual({
        path: props.path,
        status: "not-implemented",
        description: "Предметный MCP для Cluster ещё не реализован.",
      })
  })
})
