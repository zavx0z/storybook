import {describe, expect, test} from "bun:test"
import {readMcpRoot} from "@mcp/root"

describe.each([
  {name: "Подключённый проект", props: {entries: [{path: "shop", label: "Магазин", description: "Проект магазина.", parent: null}]}, count: 1},
  {name: "Пустой каталог", props: {entries: []}, count: 0},
])("$name", ({props, count}) => {
  const result = readMcpRoot(props)
  test("Независимый корневой вход", () => {
    expect(result.label, "У входа есть собственное название независимо от подключённых проектов").toBe("Вход Storybook MCP")
    expect(result.description, "Вход объясняет, как использовать адрес следующего направления").toContain("path")
    expect(result, "Корню не присваивается фиктивный адрес проекта").not.toHaveProperty("path")
    expect(result.children, "Каталог отражает только подключённые направления").toHaveLength(count)
  })
})
