import {fileURLToPath} from "node:url"
import {lstat} from "node:fs/promises"
import {resolve} from "node:path"
import {readScenario} from "@storybook/app/scenarios"
import type {ReadAssessmentInput} from "../contract/input"
import type {ReadAssessmentOutput} from "../contract/output"

type Report = ReadAssessmentOutput["reports"][number]

/** Исполняет нормативный Bun spec; его assertions остаются единственным источником требований. */
export async function executeStandard(archetype: string, file: string, input: ReadAssessmentInput): Promise<Report> {
  input.signal?.throwIfAborted()
  const path = fileURLToPath(new URL(`../../${file}`, import.meta.url))
  const report = await readScenario({path, props: {path: input.path}, ...(input.signal ? {signal: input.signal} : {})})
  input.signal?.throwIfAborted()
  const failed = report.exitCode !== 0 || report.tests.some(test => test.status === "failed" || test.status === "error")
  const incomplete = !report.tests.length || report.tests.some(test =>
    test.status !== "passed" && !(test.status === "skipped" && test.skipReason),
  )
  return {archetype, applicable: false, status: failed ? "failed" : incomplete ? "incomplete" : "passed", report}
}

/** Применимость следует из отдельного успешного утверждения нормативного сценария. */
export function matchesClass(result: Report, name: string): boolean {
  return result.report?.tests.some(test => test.label === `Класс ${name}` && test.status === "passed") ?? false
}

/** Проверяет обязательный сценарий Component с его авторскими входами. */
export function executeOwnedScenario(input: ReadAssessmentInput): Promise<Report>
/** Domain может не объявлять собственный сценарий; имеющиеся проверки исполняются без ослабления. */
export function executeOwnedScenario(input: ReadAssessmentInput, optional: true): Promise<Report | undefined>
/** Не подставляет props нормативного читателя в собственный сценарий владельца. */
export async function executeOwnedScenario(input: ReadAssessmentInput, optional = false): Promise<Report | undefined> {
  input.signal?.throwIfAborted()
  const sources: string[] = []
  for (const name of ["scenario.spec.ts", "scenario.spec.tsx"]) {
    const path = resolve(input.path, "spec", name)
    const info = await lstat(path).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    })
    if (info?.isFile() && !info.isSymbolicLink()) sources.push(path)
  }
  if (optional && sources.length === 0) return undefined
  if (sources.length !== 1) return {archetype: "behavior", applicable: true, status: "incomplete",
    message: "Для проверки поведения нужен один непосредственный сценарий владельца"}
  const report = await readScenario({path: sources[0]!, ...(input.signal ? {signal: input.signal} : {})})
  input.signal?.throwIfAborted()
  const failed = report.exitCode !== 0 || report.validation.checks.some(check => check.status === "failed")
  const incomplete = !report.tests.length || report.tests.some(test => test.status !== "passed" && !(test.status === "skipped" && test.skipReason))
  return {archetype: "behavior", applicable: true, status: failed ? "failed" : incomplete ? "incomplete" : "passed", report}
}

/** Полные отчёты остаются у оценки, наружу для диагностики выводятся только применимые нарушения. */
export function assessmentDiagnostics(reports: readonly Report[], packagePath: string): ReadAssessmentOutput["diagnostics"] {
  return reports.filter(item => item.applicable).flatMap(item => {
    if (!item.report) return [{rule: item.archetype, status: "not-checked" as const, path: packagePath,
      message: item.message ?? "Нормативная проверка не выполнена"}]
    const diagnostics: ReadAssessmentOutput["diagnostics"][number][] = item.report.tests
      .filter(test => test.status !== "passed" && !(test.status === "skipped" && test.skipReason))
      .map(test => ({rule: `${item.archetype}/${test.label}`, path: test.location.path,
        status: test.status === "failed" || test.status === "error" ? "failed" as const : "not-checked" as const,
        message: test.message ?? `Проверка «${test.label}»: ${test.status}`}))
    if (item.archetype === "behavior") for (const check of item.report.validation.checks) {
      if (check.status !== "failed") continue
      for (const issue of check.issues) diagnostics.push({rule: `behavior/${check.rule}`, status: "failed",
        path: issue.location?.path ?? item.report.path, message: issue.message})
    }
    if (!diagnostics.length && item.status !== "passed") diagnostics.push({rule: item.archetype,
      status: item.status === "failed" ? "failed" : "not-checked", path: item.report.path,
      message: `Нормативная проверка: ${item.status}, код выполнения ${item.report.exitCode}`})
    return diagnostics
  })
}
