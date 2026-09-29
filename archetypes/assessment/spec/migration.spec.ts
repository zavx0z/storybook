/**
Неполное соответствие стандарта не подтверждает миграцию компонента.
Этот отдельный пример сохраняет проверку TODO, не удваивая стоимость
одного запуска основного сценария оценки.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readAssessment} from "@archetypes/assessment"

describe.each([{name: "Незавершённая миграция", props: {path: resolve(import.meta.dir, "../../component/spec/fixture/component")}}])("$name", async ({props}) => {
  const result = await readAssessment(props)
  test("Подтверждение", () => {
    expect(result.status, "Нереализованные применимые нормы сохраняют неполный результат").toBe("incomplete")
    expect(result.classification, "Без полного подтверждения класс не публикуется").toBeNull()
  })
  test("Свидетельства", () => {
    expect(result.reports.some(report => report.archetype === "package" && report.applicable), "Общий стандарт применён").toBeTrue()
    expect(result.reports.some(report => report.archetype === "behavior" && report.applicable), "Поведение действительно проверено").toBeTrue()
  })
  test("TODO сохраняется", () => {
    expect(result.diagnostics.some(item => item.status === "not-checked" && item.rule.startsWith("component-lifecycle/")),
      "Не реализованное нормативное требование не выдаётся за соответствие").toBeTrue()
  })
})
