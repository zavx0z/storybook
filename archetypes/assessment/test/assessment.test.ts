import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {readAssessment} from "@archetypes/assessment"
import {assessmentDiagnostics, matchesClass} from "../src/execute"
import type {ReadAssessmentOutput} from "../contract/output"

/** Минимальная запись технического отчёта для проверки границы принятия решения, без запуска кода. */
function record(applicable: boolean, status: "passed" | "failed" | "incomplete"): ReadAssessmentOutput["reports"][number] {
  return {archetype: "domain", applicable, status, error: "Не удалось проверить"}
}

test("неприменимая отрицательная проба не становится предупреждением о другом классе", () => {
  expect(assessmentDiagnostics([record(false, "failed")], "/owner")).toEqual([])
  expect(assessmentDiagnostics([record(true, "incomplete")], "/owner")).toEqual([
    {rule: "domain", status: "not-checked", path: "/owner", message: "Не удалось проверить"},
  ])
  expect(matchesClass(record(false, "passed"), "Domain")).toBeFalse()
})

test("отмена оценки не превращается в incomplete или passed", async () => {
  const signal = AbortSignal.abort(new Error("Оценка отменена"))
  await expect(readAssessment({path: resolve(import.meta.dir, "../../component"), signal})).rejects.toThrow("Оценка отменена")
})
