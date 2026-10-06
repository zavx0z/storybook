import {describe, expect, test} from "bun:test"
import declaration from "@zavx0z/storybook-app-environment-declaration"

describe.each([
  {name: "Общая основа", props: {}, git: false},
  {name: "Подтверждённый Repo", props: {type: "Repo" as const}, git: true},
  {name: "Подтверждённый Component", props: {type: "Component" as const}, git: false},
])("$name", ({props, git}) => {
  const result = declaration(props)
  test("Файловые возможности", () => {
    expect(result.tools["filesystem.read"], "Каждый предмет получает ссылку на стандартный файловый инструмент")
      .toEqual({implementation: {path: expect.any(String)}, description: {path: expect.any(String)}})
  })
  test("Git-граница", () => {
    expect(Object.hasOwn(result.tools, "git.status"), "Собственную операцию Git объявляет Repo; другие предметы не получают её по имени каталога")
      .toBe(git)
  })
  test("Источники знаний", () => {
    expect(Object.values(result.documents), "Приложение выбирает декларацию владельца и сохраняет ссылки до обращения к знаниям")
      .toEqual(expect.arrayContaining([{path: expect.stringContaining("/src/architecture.md")}]))
  })
})
