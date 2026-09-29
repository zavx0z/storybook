/**
Регрессия состава самого Archetypes: публичные пути остаются связанными
с проверяющими компонентами. Этот тест реализации не является обязательной
авторской спецификацией каждого Domain.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readPackage from "@archetypes/package"

describe.each([{name: "Состав Archetypes", props: {path: resolve(import.meta.dir, "..")}}])("$name", async ({props}) => {
  const result = await readPackage(props)
  test("Ответственные компоненты", () => {
    expect(result.packages.map(item => item.name), "Project, Repo, Domain и Component имеют собственные читатели фактов")
      .toEqual(expect.arrayContaining(["@archetypes/project", "@archetypes/repo", "@archetypes/domain", "@archetypes/component"]))
  })
  test("Публичные пути", () => {
    expect(result.index.entries.filter(entry => entry.path !== "." && entry.status !== "forwarded"),
      "Предметные подпути домена ведут прямо к публичным входам вложенных пакетов").toEqual([])
  })
  test("Единая структура", () => {
    expect(Object.keys(result.packageJson.exports).filter(path => ["./entity", "./category", "./repository", "./assessment"].includes(path)),
      "Прежние конкурирующие структурные архетипы не публикуются как действующие классы").toEqual([])
  })
})
