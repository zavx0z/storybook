import {readAssessment} from "@archetypes/assessment"
import type {ReadAssessmentOutput} from "@archetypes/assessment"
import {assessmentMessages, type StorybookPackageStandard} from "../sessions/package-standard"
import {storybookBuildError, storybookDiagnostic} from "../sessions/package-session"

/**
Выполняет нормативную оценку внутри явной сборки и её общего scheduler slot.
Состав нормативных suites и классификация принадлежат Archetypes.
Технические исключения и отмена сохраняют исходный отказ.
*/
export async function checkStorybookPackageConformance(
  path: string,
  signal: AbortSignal,
  standard: StorybookPackageStandard,
): Promise<ReadAssessmentOutput> {
  const report = await readAssessment({path, signal})
  signal.throwIfAborted()
  assertPackageConformance(report, standard, path)
  return report
}

/** Строгий пакет требует полного подтверждения; технический отказ блокирует оба режима. */
export function assertPackageConformance(
  report: ReadAssessmentOutput,
  standard: StorybookPackageStandard,
  path: string,
): void {
  for (const suite of report.reports) {
    const execution = suite.report
    if (execution && (execution.tests.some(test => test.status === "error" || test.status === "failed" &&
      !execution.assertions.some(assertion => assertion.testId === test.id && assertion.status === "failed")) ||
      execution.exitCode !== 0 && !execution.tests.some(test => test.status === "failed"))) {
      throw storybookBuildError(storybookDiagnostic("validate", execution.stderr || "Технический отказ нормативной проверки", execution.path))
    }
    if (suite.applicable && suite.archetype === "behavior" && execution &&
      (execution.exitCode !== 0 || execution.tests.some(test => test.status === "failed" || test.status === "error"))) {
      throw storybookBuildError(storybookDiagnostic("validate", `Исполняемый сценарий не прошёл проверку: ${execution.stderr}`, execution.path))
    }
  }
  if (standard === "strict" && report.status !== "passed") {
    const messages = assessmentMessages(report)
    throw storybookBuildError(messages.length ? messages : storybookDiagnostic("validate", "Стандарт пакета не подтверждён полностью", path))
  }
}
