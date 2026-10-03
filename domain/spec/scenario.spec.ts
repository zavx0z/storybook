/**
Показывает сведения о предметной области без исполнения её компонентов.
Правила соответствия Package и Domain находятся в сценарии Package.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readDomain from "@archetypes/domain"

describe.each([{name: "Средовые входы счётчика", props: {path: resolve(import.meta.dir, "fixture/domain")}}])("$name", async ({props}) => {
  const result = await readDomain(props)
  test("Состав области", () => {
    expect(result.package.packages, "Малым реализациям не нужны фиктивные вложенные пакеты").toEqual([])
  })
  test("Публичные входы", () => {
    expect(result.protocols.entries.map(entry => entry.conditions), "Каждая среда сохраняет свой публичный вход и протокол")
      .toEqual([["browser"], ["node"]])
    expect(result.protocols.diagnostics, "Оба протокола прочитаны без смешения типов сред").toEqual([])
    expect(result.sharedDefinitions.map(value => value.name), "Протоколы используют одну исходную форму счётчика").toEqual(["Counter"])
    expect(result.package.documentation, "Общий index не требуется для чтения средовых документов").toBeNull()
  })
  test("Собственные сценарии", () => {
    expect(result.scenarios, "Сценарий связывает изменение и представление общей сущности")
      .toEqual([resolve(props.path, "spec/scenario.spec.ts")])
  })
})
