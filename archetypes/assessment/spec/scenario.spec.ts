/**
Применение стандарта показывает подтверждение, нарушения и незавершённость.
Режим сборки меняет lifecycle после применения ревизии, а не сам читатель оценки.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readAssessment} from "@archetypes/assessment"

describe.each([
  {name: "Предметная область без собственного spec", props: {path: resolve(import.meta.dir, "../../domain/spec/fixture/domain")}, status: "passed", classification: "domain"},
])("$name", async ({props, status, classification}) => {
  const result = await readAssessment(props)
  test("Подтверждение", () => {
    expect(result.status, "Результат учитывает все применимые нормативные suites").toBe(status)
    expect(result.classification, "Класс публикуется только после полного подтверждения стандарта").toBe(classification)
  })
  test("Свидетельства", () => {
    expect(result.reports.some(report => report.archetype === "package" && report.applicable),
      "Общие правила Package применяются независимо от предметного класса").toBeTrue()
    expect(result.reports.some(report => report.archetype === "behavior" && report.applicable),
      "Domain не требует отдельного сценария, повторяющего общие проверки структуры").toBeFalse()
  })
})
