/**
Project объединяет независимые пакеты-репозитории без копирования их identity.
Пустой проект допустим; повторная ссылка на Repo не создаёт второй экземпляр.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readProject from "@archetypes/project"

const root = resolve(import.meta.dir, "../..")
describe.each([
  {name: "Пустой проект", props: {paths: []}, count: 0},
  {name: "Проект с Repo", props: {paths: [root, root]}, count: 1},
])("$name", async ({props, count}) => {
  const result = await readProject(props)
  test("Состав", () => {
    expect(result.repositories.length, "Проект хранит неповторяющиеся ссылки на выбранные Repo").toBe(count)
  })
  test("Границы", () => {
    expect(result.repositories.filter(repo => repo.gitRoot !== repo.root), "Каждый участник имеет собственную границу Git").toEqual([])
    expect(result.nestedRoots, "Участники не являются вложенными репозиториями друг друга").toEqual([])
    expect(result.repositories.flatMap(repo => repo.nestedRepositories), "Каждый Repo соответствует запрету вложенных Repo").toEqual([])
  })
  test("Идентичность", () => {
    expect(result.duplicateNames, "Одна пакетная identity соответствует одному физическому владельцу").toEqual([])
  })
})
