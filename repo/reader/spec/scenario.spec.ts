/**
Читает Git-границу пакета на примере репозитория Storybook.
Правила соответствия Package и Repo находятся в сценарии Package.
Project объединяет Repo ссылками, а не вложенными Git-деревьями.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readRepo from "@zavx0z/storybook-repo-reader"

describe.each([{name: "Архетип Repo", props: {path: resolve(import.meta.dir, "../../..")}}])("$name", async ({props}) => {
  const result = await readRepo(props)
  test("Граница истории", () => {
    expect(result.gitRoot, "Пакет находится в точном корне собственной Git-истории").toBe(result.root)
  })
  test("Независимые репозитории", () => {
    expect(result.nestedRepositories, "В репозитории этого примера нет вложенных самостоятельных Git-репозиториев").toEqual([])
  })
})
