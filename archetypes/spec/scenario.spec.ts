/**
Archetypes предоставляет единый набор правил и прямые публичные пути
к самостоятельным проверяющим компонентам. Один стандарт читают люди и агенты.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readPackage} from "@archetypes/package"

describe.each([{name: "Состав Archetypes", props: {path: resolve(import.meta.dir, "..")}}])("$name", async ({props}) => {
  const result = await readPackage(props)
  test("Ответственные компоненты", () => {
    expect(result.packages.map(item => item.name), "Project, Repo, Domain, Component и оценка стандарта имеют самостоятельных владельцев")
      .toEqual(expect.arrayContaining(["@archetypes/project", "@archetypes/repo", "@archetypes/domain", "@archetypes/component", "@archetypes/assessment"]))
  })
  test("Публичные пути", () => {
    expect(result.index.entries.filter(entry => entry.path !== "." && entry.status !== "forwarded"),
      "Предметные подпути домена ведут прямо к публичным входам вложенных пакетов").toEqual([])
  })
  test("Единая структура", () => {
    expect(Object.keys(result.packageJson.exports).filter(path => ["./entity", "./category", "./repository"].includes(path)),
      "Прежние конкурирующие структурные архетипы не публикуются как действующие классы").toEqual([])
  })
})
