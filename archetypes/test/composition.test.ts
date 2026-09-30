/**
Регрессия состава переходной области Archetypes и вынесенных предметных пакетов:
публичные пути остаются связанными с текущими владельцами. Этот тест реализации не является обязательной
авторской спецификацией каждого Domain.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readPackage from "@archetypes/package"

describe.each([{name: "Состав Archetypes", props: {path: resolve(import.meta.dir, "..")}}])("$name", async ({props}) => {
  const result = await readPackage(props)
  test("Ответственные компоненты", () => {
    expect(result.packages.map(item => item.name), "Project и Repo пока сохраняют текущих владельцев внутри переходной области")
      .toEqual(expect.arrayContaining(["@archetypes/project", "@archetypes/repo"]))
    expect(result.packages.filter(item => ["@archetypes/domain", "@archetypes/component"].includes(item.name)),
      "Самостоятельные корневые предметы не остаются дочерними пакетами Archetypes").toEqual([])
  })
  test("Публичные пути", () => {
    expect(result.index.entries.filter(entry => entry.path !== "." && entry.status !== "forwarded"),
      "Предметные подпути домена ведут прямо к публичным входам вложенных пакетов").toEqual([])
  })
  test("Единая структура", () => {
    expect(Object.keys(result.packageJson.exports).filter(path => ["./entity", "./category", "./repository", "./assessment", "./domain", "./component"].includes(path)),
      "Прежние классы и перенесённые владельцы не получают обходных публичных путей в Archetypes").toEqual([])
  })
})

test("Domain и Component принадлежат корневому Repo с прежними identities", async () => {
  const root = resolve(import.meta.dir, "../..")
  const result = await readPackage({path: root})
  const subjects = result.packages.filter(item => ["@archetypes/domain", "@archetypes/component"].includes(item.name))
    .sort((left, right) => left.name.localeCompare(right.name))
  expect(subjects, "Физический перенос сохраняет по одному владельцу каждой identity и меняет только принадлежность")
    .toEqual([
      {name: "@archetypes/component", path: resolve(root, "component"), parent: root},
      {name: "@archetypes/domain", path: resolve(root, "domain"), parent: root},
    ])
})
