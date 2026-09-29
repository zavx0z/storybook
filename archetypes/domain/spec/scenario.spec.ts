/**
Показывает сведения о предметной области без исполнения её компонентов.
Правила соответствия Package и Domain находятся в сценарии Package.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readDomain} from "@archetypes/domain"

describe.each([{name: "Область числовых операций", props: {path: resolve(import.meta.dir, "fixture/domain")}}])("$name", async ({props}) => {
  const result = await readDomain(props)
  test("Состав области", () => {
    expect(result.package.packages.map(item => item.name), "Области принадлежит пакет счётчика")
      .toEqual(["@fixture/domain-counter"])
  })
  test("Публичные входы", () => {
    expect(result.package.index.entries.map(entry => entry.path), "Пользователь обращается к счётчику через публичный путь области")
      .toEqual(["./counter"])
    expect(result.undeclaredOwners, "Счётчик входит в объявленный состав области").toEqual([])
    expect(result.localCode, "Область не содержит собственной исполняемой реализации").toEqual([])
  })
  test("Собственные сценарии", () => {
    expect(result.scenarios, "Общие правила структуры проверяются сценарием Package; область этого примера не дублирует их")
      .toEqual([])
  })
})
