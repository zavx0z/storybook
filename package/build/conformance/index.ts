/**
Проверяет пакет единым нормативным сценарием и сохраняет исходное свидетельство.
Технический отказ не превращается в успешную проверку или понижение строгости.

@packageDocumentation
*/
import {type PackageStandard as PackageStandardContract} from "@package/standard"
import PackageSessionOwner from "@package/session"
const storybookBuildError = PackageSessionOwner.buildError
const storybookDiagnostic = PackageSessionOwner.diagnostic
type StorybookPackageVerification = NonNullable<Parameters<PackageStandardContract.Output["applied"]>[1]>
import {fileURLToPath} from "node:url"
import readScenario, {type ArchetypesScenarioReader} from "@archetypes/scenario-reader"
/** Форма исходного публичного владельца. */
type ReadScenarioOutput = ArchetypesScenarioReader.Output
import type {PackageBuildConformance} from "./contract"

export type {PackageBuildConformance} from "./contract"

/**
Исполняет единый нормативный сценарий Package тем же читателем Specs, что документация и MCP.
Применимость и однозначность классов выражены внутри сценария.
Возвращает исходный отчёт одного запуска; технический отказ и отмена пробрасываются.
*/
async function checkStorybookPackageConformance(
  path: string,
  signal: AbortSignal,
): Promise<ReadScenarioOutput> {
  return readScenario({
    path: fileURLToPath(new URL("../../reader/spec/scenario.spec.ts", import.meta.url)),
    props: {path}, signal,
  })
}

/** TODO остаётся в исходном отчёте, но не влияет на успех. Ошибки и невыполненные проверки сохраняют свой исход. */
function scenarioVerification(report: ReadScenarioOutput): StorybookPackageVerification {
  const failed = report.tests.filter(test => test.status === "failed" || test.status === "error")
  if (failed.some(test => test.status === "error" || !report.assertions.some(assertion =>
    assertion.testId === test.id && assertion.status === "failed")) || report.exitCode !== 0 && failed.length === 0) {
    throw storybookBuildError(storybookDiagnostic("validate", report.stderr || "Технический отказ нормативной проверки", report.path))
  }
  const pending = report.tests.filter(test => test.status !== "passed" && test.status !== "failed" && test.status !== "todo" &&
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

/** Нормативный запуск и интерпретация отчёта остаются одной проверкой пакета. */
const conformance: PackageBuildConformance.Output = Object.freeze({check: checkStorybookPackageConformance, verify: scenarioVerification})

export default conformance
