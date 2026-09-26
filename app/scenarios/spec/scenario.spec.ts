/**
Показывает полный технический отчёт сценария функции и компонента.
Исходник, трасса, вывод и проверки сохраняются для подробного просмотра App.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "@storybook/app/scenarios"

describe.each([
  {name: "Отчёт функции", props: {path: resolve(import.meta.dir, "fixture/function/spec/scenario.spec.ts")}},
  {name: "Отчёт компонента", props: {path: resolve(import.meta.dir, "fixture/component/spec/scenario.spec.tsx")}},
])("$name", async ({props}) => {
  const report = await readScenario(props)

  test("Исходник", () => {
    expect(report.source, "Структура и полный исходный код одного сценария").toMatchObject({path: props.path, text: expect.any(String)})
  })
  test("Технический отчёт", () => {
    expect(report, "App сохраняет трассу, проверки, потоки вывода и штатный JUnit").toMatchObject({
      exitCode: 0,
      calls: expect.any(Array),
      tests: expect.any(Array),
      assertions: expect.any(Array),
      stdout: expect.any(String),
      stderr: expect.any(String),
      junit: expect.any(String),
    })
  })
  test("Подготовленный просмотр", () => {
    expect(report.preview?.variants.length, "Варианты того же запуска доступны приложению").toBeGreaterThan(0)
    expect(report.validation.checks.length, "Приложение сохраняет полный результат правил Archetypes").toBeGreaterThan(0)
  })
})
