import {expect, test} from "bun:test"
import type {ReadAssessmentOutput} from "@archetypes/assessment"
import type {ReadScenarioOutput} from "@storybook/app/scenarios"
import {assertPackageConformance} from "./package-conformance"
import {appliedPackageStandard, readPackageAssessment} from "../sessions/package-standard"

const passed: ReadAssessmentOutput = {status: "passed", classification: "domain", reports: [], diagnostics: []}

test.each(["failed", "incomplete"] as const)("%s предупреждает переходный пакет и блокирует строгий", status => {
  const report: ReadAssessmentOutput = {...passed, status, classification: null,
    diagnostics: [{rule: "package/contract", status: "not-checked", path: "/package", message: "Проверка не завершена"}]}
  expect(() => assertPackageConformance(report, "transition", "/package")).not.toThrow()
  expect(() => assertPackageConformance(report, "strict", "/package")).toThrow("Проверка не завершена")
  expect(appliedPackageStandard("transition", report, [])).toBe("transition")
  expect(appliedPackageStandard("strict", report, [])).toBe("strict")
})

test("ошибка исполнения блокирует оба режима независимо от нормативных предупреждений", () => {
  const report: ReadAssessmentOutput = {...passed, status: "failed", classification: null, reports: [{
    archetype: "behavior", applicable: true, status: "failed",
    report: {path: "/package/spec/scenario.spec.ts", exitCode: 1, stderr: "runtime error", tests: []} as unknown as ReadScenarioOutput,
  }]}
  for (const standard of ["transition", "strict"] as const) {
    expect(() => assertPackageConformance(report, standard, "/package")).toThrow("runtime error")
  }
})

test("отрицательная проба другого класса не блокирует подтверждённый пакет", () => {
  const report: ReadAssessmentOutput = {...passed, reports: [{archetype: "repo", applicable: false, status: "failed"}]}
  expect(() => assertPackageConformance(report, "strict", "/package")).not.toThrow()
  expect(appliedPackageStandard("transition", report, [])).toBe("strict")
})

test("исключение внутри нормативного теста не маскируется предупреждением", () => {
  const report: ReadAssessmentOutput = {...passed, status: "failed", classification: null, reports: [{
    archetype: "package", applicable: true, status: "failed",
    report: {path: "/standard/spec/scenario.spec.ts", exitCode: 1, stderr: "TypeError: broken checker",
      tests: [{id: 1, status: "failed"}], assertions: []} as unknown as ReadScenarioOutput,
  }]}
  expect(() => assertPackageConformance(report, "transition", "/package")).toThrow("broken checker")
})

test("предупреждение preview не допускает автоматического перехода", () => {
  expect(appliedPackageStandard("transition", passed, [{phase: "validate", path: "/package", message: "Нет preview"}])).toBe("transition")
})

test("сохранённое passed без класса или с незавершённым требованием не является свидетельством", () => {
  expect(() => readPackageAssessment({...passed, classification: null})).toThrow()
  expect(() => readPackageAssessment({...passed, diagnostics: [{rule: "todo", path: "/package", message: "TODO", status: "not-checked"}]})).toThrow()
})
