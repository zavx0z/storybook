/**
Читает состав Project из объявленных установленных зависимостей.
Локальные пакеты сохраняют исходный Repo; библиотеке из npm собственный Git не требуется.

@packageDocumentation
*/
import {afterAll, describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readProject from "@zavx0z/storybook-project"
import {createProjectFixture} from "./fixture"
import type {FixtureDependency} from "./fixture"

const independent: readonly FixtureDependency[] = [
  {key: "@fixture/first-alias", path: "sources/arbitrary first", name: "@fixture/first"},
  {key: "@fixture/second", path: "sources/another-location", name: "@fixture/second", development: true},
]
const repeated: readonly FixtureDependency[] = [
  {key: "first", path: "sources/one", name: "@fixture/repeated"},
  {key: "second", path: "sources/two", name: "@fixture/repeated"},
]
const nested: readonly FixtureDependency[] = [
  {key: "outer", path: "sources/outer", name: "@fixture/outer"},
  {key: "inner", path: "sources/outer/inner", name: "@fixture/inner"},
]
const installed: readonly FixtureDependency[] = [{key: "library", path: "unused", name: "@fixture/installed-library", installed: true}]
const shared: readonly FixtureDependency[] = [
  {key: "first", path: "sources/mono/first", name: "@fixture/first", repository: "sources/mono"},
  {key: "second", path: "sources/mono/second", name: "@fixture/second", repository: "sources/mono"},
]
const aliases: readonly FixtureDependency[] = [
  {key: "first", path: "sources/source", name: "@fixture/source"},
  {key: "alias", path: "sources/source", name: "@fixture/source", development: true},
]

describe.each([
  {name: "Пустой Project", ...await createProjectFixture([]), packages: [], repos: [], duplicateNames: [], nestedPaths: []},
  {name: "Внешние исходные Repo", ...await createProjectFixture(independent), packages: independent, repos: independent, duplicateNames: [], nestedPaths: []},
  {name: "Повторные identity Repo", ...await createProjectFixture(repeated), packages: repeated, repos: repeated, duplicateNames: ["@fixture/repeated"], nestedPaths: []},
  {name: "Вложенные исходные Repo", ...await createProjectFixture(nested), packages: nested, repos: nested, duplicateNames: [], nestedPaths: ["sources/outer/inner"]},
  {name: "Установленная npm библиотека", ...await createProjectFixture(installed), packages: installed, repos: [], duplicateNames: [], nestedPaths: []},
  {name: "Два пакета одного Repo", ...await createProjectFixture(shared), packages: shared, repos: [{path: "sources/mono", name: "@fixture/source-repo"}], duplicateNames: [], nestedPaths: []},
  {name: "Две ссылки на один пакет", ...await createProjectFixture(aliases), packages: [aliases[0]!], repos: [aliases[0]!], duplicateNames: [], nestedPaths: []},
])("$name", async ({props, directory, root, cleanup, packages, repos, duplicateNames, nestedPaths}) => {
  afterAll(cleanup)
  const result = await readProject(props)

  test("Идентичность Project", () => {
    expect({root: result.root, name: result.name},
      "Project сохраняет канонический корень и точное имя собственного package.json; label и имя директории его не подменяют")
      .toEqual({root, name: "@fixture/authored-project"})
  })

  test("Установленный состав", () => {
    expect(result.dependencies,
      "dependencies и devDependencies раскрывают фактические пакеты; npm aliases сохраняют имя манифеста, повторные physical roots объединяются")
      .toEqual(packages.map(dependency => ({
        root: dependency.installed ? resolve(root, "node_modules", dependency.key) : resolve(directory, dependency.path),
        name: dependency.name,
        repository: dependency.installed ? null : resolve(directory, dependency.repository ?? dependency.path),
      })))
  })

  test("Исходные Repo", () => {
    expect(result.repositories,
      "Локальные checkout сохраняют собственные identity; пакеты одного Repo объединяются, npm библиотека не наследует Git Project")
      .toEqual(repos.map(repo => ({root: resolve(directory, repo.path), name: repo.name})))
  })

  test("Повторные identity Repo", () => {
    expect(result.duplicateNames,
      "Разные исходные Repo с одной пакетной identity сохраняются в составе и явно раскрывают конфликт имени")
      .toEqual(duplicateNames)
  })

  test("Вложенность Repo", () => {
    expect(result.nestedRoots,
      "Диагностика показывает Repo внутри другого исходного Repo и не включает Project или установленные npm пакеты")
      .toEqual(nestedPaths.map(path => resolve(directory, path)))
  })
})
