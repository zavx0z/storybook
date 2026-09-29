/**
Repo — корневой пакет самостоятельного монорепозитория.
Project объединяет Repo ссылками, а не вложенными Git-деревьями.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readRepo} from "@archetypes/repo"

describe.each([{name: "Архетип Repo", props: {path: resolve(import.meta.dir, "../../..")}}])("$name", async ({props}) => {
  const result = await readRepo(props)
  test("Класс Repo", () => {
    expect(result.gitRoot, "Пакет находится в точном корне собственной Git-истории").toBe(result.root)
  })
  test("Независимые репозитории", () => {
    expect(result.nestedRepositories, "Другие самостоятельные Repo подключаются к Project, а не вкладываются в этот Repo").toEqual([])
  })
})
