import {fileURLToPath} from "node:url"
import {readScenario, type ReadScenarioOutput} from "@storybook/app-old/scenarios"
import type {StorybookPackageVerification} from "../sessions/package-standard"
import {storybookBuildError, storybookDiagnostic} from "../sessions/package-session"

/**
Исполняет единый нормативный сценарий Package тем же App, что документация и MCP.
Применимость и однозначность классов выражены внутри сценария.
Возвращает исходный отчёт одного запуска; технический отказ и отмена пробрасываются.
*/
export async function checkStorybookPackageConformance(
  path: string,
  signal: AbortSignal,
): Promise<ReadScenarioOutput> {
  return readScenario({
    path: fileURLToPath(new URL("../archetypes/package/spec/scenario.spec.ts", import.meta.url)),
    props: {path}, signal,
  })
}

/** Native исходы задают полноту; исключение без проваленного assertion остаётся технической ошибкой. */
export function scenarioVerification(report: ReadScenarioOutput): StorybookPackageVerification {
  const failed = report.tests.filter(test => test.status === "failed" || test.status === "error")
  if (failed.some(test => test.status === "error" || !report.assertions.some(assertion =>
    assertion.testId === test.id && assertion.status === "failed")) || report.exitCode !== 0 && failed.length === 0) {
    throw storybookBuildError(storybookDiagnostic("validate", report.stderr || "Технический отказ нормативной проверки", report.path))
  }
  const pending = report.tests.filter(test => test.status !== "passed" && test.status !== "failed" &&
    !(test.status === "skipped" && test.skipReason))
  const authoring = report.validation.checks.filter(check => check.status === "failed" && check.rule !== "execution")
  const diagnostics = [
    ...[...failed, ...pending].map(test => storybookDiagnostic("validate",
      test.message ?? `Проверка «${test.label}»: ${test.status}`, test.location.path)),
    ...authoring.flatMap(check => check.issues.map(issue => storybookDiagnostic("validate", `[${check.rule}] ${issue.message}`, issue.location?.path ?? report.path))),
  ]
  const executed = report.tests.some(test => test.status === "passed" || test.status === "failed")
  if (!executed) diagnostics.push(storybookDiagnostic("validate", "Сценарий не выполнил ни одной проверки", report.path))
  return {status: failed.length || authoring.length ? "failed" : pending.length || !executed ? "incomplete" : "passed", diagnostics}
}
