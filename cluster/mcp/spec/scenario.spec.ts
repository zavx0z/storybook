import {describe, expect, test} from "bun:test"
import readMcp from "@zavx0z/storybook-cluster-mcp"

const selected = {path: "example/owner", label: "Владелец", description: "Назначение сущности.", parent: "example"}
const child = {path: "example/owner/part", label: "Участник", description: "Назначение участника.", parent: selected.path}

describe.each([
  {name: "Cluster без вложенных направлений", props: {selected, entries: [{...selected}]}, children: []},
  {name: "Cluster с вложенным направлением", props: {selected, entries: [{...selected}, {...child}]},
    children: [{path: `./${child.path}`, label: child.label, description: child.description}]},
])("$name", async ({props, children}) => {
  const result = await readMcp(props)
  test("Содержание владельца", () => {
    expect(result, "Предметный MCP возвращает авторское назначение и только непосредственные переходы")
      .toEqual({description: selected.description, path: `./${selected.path}`, label: selected.label, children})
  })
})
