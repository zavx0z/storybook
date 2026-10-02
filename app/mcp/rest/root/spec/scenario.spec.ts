import {describe, expect, test} from "bun:test"
import readMcpRoot from "@mcp/root"

describe.each([
  {name: "Project с Repo", props: {projectName: "Fixture Project", entries: [{path: "shop", label: "Магазин", description: "Repo магазина.", parent: null}]}, count: 1},
  {name: "Пустой каталог", props: {projectName: "Fixture Project", entries: []}, count: 0},
])("$name", ({props, count}) => {
  const result = readMcpRoot(props)
  test("Имя Project и состав", () => {
    expect(result.label, "Имя Project сохраняется независимо от наличия Repo").toBe(props.projectName)
    expect(result.description, "Вход объясняет, как использовать адрес следующего направления").toContain("path")
    expect(result, "Корню не присваивается фиктивный адрес проекта").not.toHaveProperty("path")
    expect(result.children, "Каталог отражает только направления текущего состава").toHaveLength(count)
  })
})
