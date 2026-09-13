/** Проверяет обработку повреждённого отчёта на результате существующей спецификации. @packageDocumentation */
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {runTests} from "../src/run-tests.ts"
import {transformReport} from "../src/transform-report.ts"

const root = resolve(import.meta.dir, "../..")
const raw = await runTests({
    path: resolve(root, "archetypes/specs/spec/fixture/parameterization/spec"),
    specification: resolve(root, "archetypes/specs/spec/parameterization.spec.ts"),
    pathVariable: "SPEC_DIRECTORY",
    testNamePattern: "^Describe использует each",
})

describe.each([
  {name: "Отчёт отсутствует", props: {junit: null}, fail: "Отсутствующий JUnit должен давать ошибку преобразования"},
  {name: "Отчёт повреждён", props: {junit: "<testsuites>"}, fail: "Повреждённый JUnit должен давать ошибку преобразования"},
])("$name", ({props, fail}) => {
  const actual = transformReport({...raw, junit: props.junit})

  test("Сохраняет исходный вывод при ошибке", () => {
    expect({status: actual.status, stdout: actual.process.stdout, stderr: actual.process.stderr}, fail).toEqual({
      status: "error", stdout: raw.stdout, stderr: raw.stderr,
    })
  })
})
