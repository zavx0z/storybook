/**
Проверяет пакет единым нормативным сценарием и сохраняет исходное свидетельство.
Технический отказ не превращается в успешную проверку или понижение строгости.
Тип сущности читается из единственной применимой группы отчёта без ошибок.
TODO не блокирует выбор типа. Невыполненные проверки и неоднозначность сохраняют
неизвестность. Изменение исходников не отменяет отчёт уже проверенной ревизии.

@packageDocumentation
*/
import {type Zavx0zStorybookPackageStandard as PackageStandardContract} from "@zavx0z/storybook-package-standard"
import PackageSessionOwner from "@zavx0z/storybook-package-session"
const storybookBuildError = PackageSessionOwner.buildError
const storybookDiagnostic = PackageSessionOwner.diagnostic
type StorybookPackageVerification = NonNullable<Parameters<PackageStandardContract.Output["applied"]>[1]>
import {fileURLToPath} from "node:url"
import {resolve} from "node:path"
import readScenario, {type Zavx0zStorybookSpecsScenariosReader} from "@zavx0z/storybook-specs-scenarios-reader"
/** Форма исходного публичного владельца. */
type ReadScenarioOutput = Zavx0zStorybookSpecsScenariosReader.Output
import type {Zavx0zStorybookPackageBuildConformance} from "./contract"
import {identifyType} from "./src/identify"

export type {Zavx0zStorybookPackageBuildConformance} from "./contract"

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
const conformance: Zavx0zStorybookPackageBuildConformance.Output = Object.freeze({
  check: checkStorybookPackageConformance,
  verify: scenarioVerification,
  identify(report, path) {
    const scenario = fileURLToPath(new URL("../../reader/spec/scenario.spec.ts", import.meta.url))
    return identifyType(report, resolve(path), scenario, scenarioVerification)
  },
})

export default conformance
