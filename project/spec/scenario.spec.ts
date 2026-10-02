/**
Читает конкретный Project из Git superproject и сохраняет его собственную identity.
Физические адреса участников задаются .gitmodules независимо от их имён пакетов.

@packageDocumentation
*/
import {afterAll, describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readProject from "@archetypes/project"
import {createProjectFixture} from "./fixture"

const independent = [
  {section: "first.logical.name", path: "sources/arbitrary first", name: "@fixture/first"},
  {section: "second", path: "tools/another-location", name: "@fixture/second"},
]
const repeated = [
  {section: "first", path: "one", name: "@fixture/repeated"},
  {section: "second", path: "two", name: "@fixture/repeated"},
]
const nested = [
  {section: "outer", path: "outer", name: "@fixture/outer"},
  {section: "inner", path: "outer/inner", name: "@fixture/inner"},
]

describe.each([
  {
    name: "Пустой Project",
    ...await createProjectFixture([]),
    repositories: [],
    duplicateNames: [],
    nestedPaths: [],
  },
  {
    name: "Project с независимыми Repo",
    ...await createProjectFixture(independent),
    repositories: independent,
    duplicateNames: [],
    nestedPaths: [],
  },
  {
    name: "Повторные пакетные identity",
    ...await createProjectFixture(repeated),
    repositories: repeated,
    duplicateNames: ["@fixture/repeated"],
    nestedPaths: [],
  },
  {
    name: "Вложенные участники",
    ...await createProjectFixture(nested),
    repositories: nested,
    duplicateNames: [],
    nestedPaths: ["outer/inner"],
  },
])("$name", async ({props, root, cleanup, repositories, duplicateNames, nestedPaths}) => {
  afterAll(cleanup)
  const result = await readProject(props)

  test("Идентичность Project", () => {
    expect({root: result.root, name: result.name},
      "Project сохраняет канонический Git-корень и точное имя собственного package.json; label и имя директории его не подменяют")
      .toEqual({root, name: "@fixture/authored-project"})
  })

  test("Состав Repo", () => {
    expect(result.repositories,
      "Участники и их порядок следуют из .gitmodules; projects.json не читается и случайные каталоги не добавляются")
      .toEqual(repositories.map(repo => ({root: resolve(root, repo.path), name: repo.name})))
  })

  test("Пакетные identity", () => {
    expect(result.duplicateNames,
      "Разные физические Repo с одной пакетной identity остаются в составе и явно раскрывают конфликт имени")
      .toEqual(duplicateNames)
  })

  test("Вложенность участников", () => {
    expect(result.nestedRoots,
      "Диагностика показывает Repo внутри другого участвующего Repo; принадлежность самому superproject не считается конфликтом")
      .toEqual(nestedPaths.map(path => resolve(root, path)))
  })
})
