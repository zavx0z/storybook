import {XMLParser, XMLValidator} from "fast-xml-parser"
import {resolve} from "node:path"
import type {BunTestResult} from "./run-tests.ts"
import type {ValidationOutput} from "../contract/output.ts"

/** Разбирает штатный JUnit Bun, сохраняя сообщения и не выводя правила из терминального текста. */
function readReport(xml: string, cwd: string): Pick<ValidationOutput, "tests" | "summary"> {
  if (/<!DOCTYPE/iu.test(xml)) throw new Error("JUnit не должен содержать DOCTYPE")
  const validation = XMLValidator.validate(xml)
  if (validation !== true) throw new Error(`Некорректный XML отчёта JUnit: ${validation.err.msg} (${validation.err.line}:${validation.err.col})`)
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    htmlEntities: true,
    isArray: name => ["testsuite", "testcase", "failure", "error", "skipped"].includes(name),
  })
  const parsed = parser.parse(xml) as {testsuites?: Record<string, unknown>}
  const root = parsed.testsuites
  if (!root || typeof root !== "object") throw new Error("В JUnit отсутствует testsuites")
  const tests: ValidationOutput["tests"][number][] = []
  const visit = (suite: Record<string, unknown>) => {
    for (const value of (suite.testcase ?? []) as Record<string, unknown>[]) {
      if (typeof value.name !== "string" || typeof value.file !== "string") throw new Error("В JUnit отсутствуют имя или файл теста")
      const failure = ((value.failure ?? value.error ?? []) as Record<string, unknown>[])[0]
      const details = failure ? String(failure["#text"] ?? failure.message ?? "") : null
      const fullMessage = failure ? String(failure.message ?? details ?? "") : null
      tests.push({
        name: value.name,
        group: String(value.classname ?? ""),
        file: resolve(cwd, value.file),
        line: value.line === undefined ? null : Number(value.line),
        status: value.error !== undefined ? "error" : value.failure !== undefined ? "failed" : value.skipped !== undefined ? "skipped" : "passed",
        message: fullMessage === null ? null : fullMessage.split(/\r?\n/u)[0]!,
        details,
      })
    }
    for (const child of (suite.testsuite ?? []) as Record<string, unknown>[]) visit(child)
  }
  visit(root)
  if (Number(root.tests) !== tests.length) throw new Error("Число тестов в JUnit не совпадает с содержимым отчёта")
  return {
    tests,
    summary: {
      total: tests.length,
      passed: tests.filter(test => test.status === "passed").length,
      failed: tests.filter(test => test.status === "failed").length,
      skipped: tests.filter(test => test.status === "skipped").length,
      errors: tests.filter(test => test.status === "error").length,
    },
  }
}

/**
Преобразует результат Bun в статусы проверок, сводку и диагностические сообщения.

@param raw - Неизменённый результат runTests; повторный запуск тестов не производится.
@returns Единый отчёт. Исходный вывод сохранён в process, ошибки запуска отделены от провалов проверок.
*/
export function transformReport(raw: BunTestResult): ValidationOutput {
  const process = {
    exitCode: raw.exitCode, signal: raw.signal, stdout: raw.stdout, stderr: raw.stderr, junit: raw.junit,
  }
  let report: Pick<ValidationOutput, "tests" | "summary"> = {
    tests: [], summary: {total: 0, passed: 0, failed: 0, skipped: 0, errors: 0},
  }
  try {
    if (raw.error !== null) throw new Error(raw.error)
    if (raw.junit === null) throw new Error("Bun не предоставил JUnit-отчёт")
    report = readReport(raw.junit, raw.cwd)
    const hasFailures = report.summary.failed > 0 || report.summary.errors > 0
    if (raw.signal !== null || (raw.exitCode !== 0 && !hasFailures)) throw new Error("Процесс завершился с ошибкой вне результатов тестов")
    if (raw.exitCode === 0 && hasFailures) throw new Error("Код завершения не соответствует отчёту JUnit")
    return {
      path: raw.path, specification: raw.specification, ...report,
      status: hasFailures ? "failed" : report.summary.passed === 0 ? "empty" : "passed",
      process, error: null,
    }
  } catch (error) {
    return {
      path: raw.path, specification: raw.specification, ...report, status: "error", process,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
