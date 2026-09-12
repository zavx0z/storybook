/**
Проверяет два этапа валидатора на существующих правилах и фикстурах Archetypes.
Первый тест показывает исходный результат Bun, второй — его преобразование.
Правила структуры здесь не определяются и не копируются.

@packageDocumentation
*/
import {beforeAll, describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {runTests, type BunTestResult} from "../src/run-tests.ts"
import {transformReport} from "../src/transform-report.ts"

const root = resolve(import.meta.dir, "../..")
const fixturePath = (path: string) => resolve(root, "archetypes/specs/spec/fixture", path)
const parameterization = resolve(root, "archetypes/specs/spec/parameterization.spec.ts")

describe.each([
  {
    name: "Отчёт по существующей корректной фикстуре",
    props: {path: fixturePath("parameterization/spec"), specification: parameterization, pathVariable: "SPEC_DIRECTORY"},
    expected: {exitCode: 0, status: "passed", total: 4, passed: 4, failed: 0, skipped: 0},
    fail: "Запуск и преобразование должны сохранить успешный результат исходных тестов",
  },
  {
    name: "Отчёт по существующей фикстуре с нарушением",
    props: {path: fixturePath("invalid-spec/spec"), specification: parameterization, pathVariable: "SPEC_DIRECTORY"},
    expected: {exitCode: 1, status: "failed", total: 4, passed: 0, failed: 4, skipped: 0},
    fail: "Нарушение из Archetypes должно сохраниться в исходном и преобразованном отчёте",
  },
  {
    name: "Отчёт по реальному пакету",
    props: {
      path: resolve(root, "archetypes/specs"),
      specification: resolve(root, "archetypes/package/spec/requirement.spec.ts"),
      pathVariable: "PACKAGE_PATH",
    },
    expected: {exitCode: 0, status: "passed", total: 2, passed: 1, failed: 0, skipped: 1},
    fail: "Проверки реального пакета должны сохранять выполненные и пропущенные тесты",
  },
])("$name", ({props, expected, fail}) => {
  let raw: BunTestResult
  beforeAll(async () => {
    raw = await runTests(props)
  }, 35_000)

  test.each([{runtime: async () => {}}])("Исходный результат Bun", () => {
    expect({...raw}, fail).toMatchObject({
      path: props.path,
      specification: props.specification,
      exitCode: expected.exitCode,
      signal: null,
      stdout: expect.stringContaining("bun test"),
      stderr: expect.any(String),
      junit: expect.stringContaining("<testsuites"),
      error: null,
    })
  })

  test.each([{runtime: async () => {}}])("Преобразованный отчёт", () => {
    const report = transformReport(raw)
    expect({
      status: report.status,
      path: report.path,
      summary: report.summary,
      preserved: report.process.stdout === raw.stdout && report.process.stderr === raw.stderr && report.process.junit === raw.junit,
      named: report.tests.every(item => item.name.length > 0 && item.file.length > 0),
      readable: report.tests.filter(item => item.status === "failed").every(item => item.message !== null && !item.message.includes("&#10;") && item.details?.includes("scenario.spec.ts: describe")),
      error: report.error,
    }, fail).toEqual({
      status: expected.status,
      path: props.path,
      summary: {total: expected.total, passed: expected.passed, failed: expected.failed, skipped: expected.skipped, errors: 0},
      preserved: true,
      named: true,
      readable: true,
      error: null,
    })
  })
})
