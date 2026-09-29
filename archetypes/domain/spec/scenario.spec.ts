/**
Проверяет границу Domain и принадлежность его публичных входов.
Предметные правила области остаются в её собственном сценарии.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readDomain} from "@archetypes/domain"

describe.each([{name: "Архетип Domain", props: {path: resolve(import.meta.dir, "fixture/domain")}}])("$name", async ({props}) => {
  const result = await readDomain(props)

  test("Класс Domain", () => {
    expect(result.package.packages.length, "Область имеет самостоятельные пакеты своих частей").toBeGreaterThan(0)
    expect(result.localCode, "Domain не реализует собственный исполняемый Component; публичный код принадлежит частям").toEqual([])
  })
  test("Принадлежность публичных входов", () => {
    expect(result.undeclaredOwners, "Публичные пути ведут к участникам действительного состава области").toEqual([])
    expect(result.package.index.entries.filter(entry => entry.code && entry.status !== "forwarded" && entry.status !== "blocked"
      && !(entry.status === "owned" && entry.path === "." && !result.localCode.includes(entry.path))),
      "Кодовые подпути прямо открывают публичные входы вложенных пакетов").toEqual([])
  })
  test("Правила области", () => {
    expect(result.scenarios.length, "Непосредственный сценарий раскрывает и проверяет предметные правила области").toBe(1)
  })
})
