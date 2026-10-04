import PackageStandardOwner from "@zavx0z/storybook-package-standard"
const appliedPackageStandard = PackageStandardOwner.applied
const readPackageVerification = PackageStandardOwner.readVerification
import {expect, test} from "bun:test"
import type {StorybookSpecsScenariosReader} from "@zavx0z/storybook-specs-scenarios-reader"
/** Форма исходного публичного владельца. */
type ReadScenarioOutput = StorybookSpecsScenariosReader.Output
import conformance from "../index"

const scenarioVerification = conformance.verify

/** Минимальные native outcomes для проверки политики, независимые от названий архетипов. */
function report(statuses: ReadScenarioOutput["tests"][number]["status"][]): ReadScenarioOutput {
  return {
    path: "/standard/spec/scenario.spec.ts", exitCode: statuses.includes("failed") ? 1 : 0, stderr: "",
    tests: statuses.map((status, id) => ({id, label: id === 0 ? "Класс Domain" : "Публичный контракт", status,
      location: {path: "/standard/spec/scenario.spec.ts", line: id + 1, column: 1}, message: null, skipReason: null})),
    assertions: statuses.flatMap((status, testId) => status === "failed" ? [{testId, status: "failed"}] : []),
    validation: {checks: []},
  } as unknown as ReadScenarioOutput
}

test("один успешный именованный пункт не заменяет полное прохождение сценария", () => {
  const verification = scenarioVerification(report(["passed", "failed"]))
  expect(verification.status).toBe("failed")
  expect(appliedPackageStandard("transition", verification, [])).toBe("transition")
  expect(appliedPackageStandard("strict", verification, [])).toBe("strict")
})

test.each(["not-executed", "skipped"] as const)("обязательный %s удерживает незавершённость", status => {
  const verification = scenarioVerification(report(["passed", status]))
  expect(verification.status).toBe("incomplete")
  expect(verification.diagnostics).toHaveLength(1)
  expect(appliedPackageStandard("transition", verification, [])).toBe("transition")
})

test("документированная неприменимость не отменяет выполненные общие требования", () => {
  const source = report(["passed", "skipped"])
  const value = {...source, tests: source.tests.map(test => test.status === "skipped"
    ? {...test, skipReason: "Выходной контракт данных не применим к визуальному компоненту"} : test)}
  expect(scenarioVerification(value).status).toBe("passed")
  expect(appliedPackageStandard("transition", scenarioVerification(value), [])).toBe("strict")
})

test("отсутствие выполненных проверок не подтверждает стандарт", () => {
  expect(scenarioVerification(report([])).status).toBe("incomplete")
})

test("исключение без failed assertion остаётся технической ошибкой", () => {
  expect(() => scenarioVerification({...report(["failed"]), assertions: [], stderr: "TypeError: checker"})).toThrow("checker")
})

test("нормативные предупреждения и неполный receipt не допускают повышения", () => {
  const passed = scenarioVerification(report(["passed"]))
  expect(appliedPackageStandard("transition", passed, [{phase: "validate", path: "/package", message: "Нет preview"}])).toBe("transition")
  expect(() => readPackageVerification({...passed, diagnostics: [{phase: "validate", path: "/package", message: "TODO"}]})).toThrow()
})


test("TODO не изменяет успех выполненных проверок и остаётся виден в отчёте", () => {
  const source = report(["passed", "todo"])
  expect(scenarioVerification(source)).toEqual(scenarioVerification(report(["passed"])))
  expect(source.tests[1]!.status).toBe("todo")
  expect(appliedPackageStandard("strict", scenarioVerification(source), [])).toBe("strict")
})

test("TODO не скрывает провал, исключение или отсутствие выполненных проверок", () => {
  expect(scenarioVerification(report(["passed", "failed", "todo"])).status).toBe("failed")
  expect(() => scenarioVerification({...report(["passed", "todo"]), exitCode: 1, stderr: "runtime failure"})).toThrow("runtime failure")
  expect(scenarioVerification(report(["todo"])).status).toBe(scenarioVerification(report([])).status)
})
