/**
Показывает правило описания проверяемых данных рядом с expect.
Технический исполнитель передаёт наблюдения, а Archetypes решает,
соответствует ли исходник принятому правилу авторства.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {validateScenario} from "@archetypes/specs/scenarios/validation"

describe.each([
  {name: "Описание рядом с данными", inline: true, expected: "passed"},
  {name: "Описание вынесено", inline: false, expected: "failed"},
])("$name", ({inline, expected}) => {
  const path = resolve(import.meta.dir, "scenario.spec.ts")
  const location = {path, line: 1, column: 1}
  const result = validateScenario({
    path,
    native: ["describe", "test", "expect"],
    registrations: [{kind: "describe", depth: 0, modifiers: ["each"], scope: "module", label: "Пример", location, remarks: null}],
    assertions: [{inline, message: "Смысл проверяемого значения", location}],
    tests: [{todo: false, assertions: 1, label: "Значение", location}],
  }, {
    groups: [{parentId: null, label: "Пример"}],
    calls: [{test: null, describe: ["Пример"]}],
    tests: [{status: "passed", label: "Значение", message: null, location}],
    exitCode: 0,
  })

  test("Объяснение проверки", () => {
    expect(result.checks.find(check => check.rule === "inline-description"),
      "Пояснение пишется в том же expect, а не выводится из фактического результата").toMatchObject({status: expected})
    expect(result.checks.find(check => check.rule === "meaning")?.status,
      "Смысловая достаточность примера остаётся непроверенной").toBe("not-checked")
  })
})
