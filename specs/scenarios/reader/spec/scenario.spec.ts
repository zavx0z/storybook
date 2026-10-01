/**
Показывает полный технический отчёт сценария функции и компонента.
Исходник, трасса, вывод и проверки сохраняются для подробного просмотра App.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from "@archetypes/scenario-reader"

describe.each([
  {name: "Компонент со слотами", props: {path: resolve(import.meta.dir, "fixture/slots/spec/scenario.spec.tsx")}},
  {name: "Отчёт функции", props: {path: resolve(import.meta.dir, "fixture/function/spec/scenario.spec.ts")}},
  {name: "Вложенные варианты", props: {path: resolve(import.meta.dir, "fixture/component/spec/nested.test.tsx")}},
  {name: "Компонент с children", props: {path: resolve(import.meta.dir, "fixture/component/spec/children.test.tsx")}},
  {name: "Отчёт компонента", props: {path: resolve(import.meta.dir, "fixture/component/spec/scenario.spec.tsx")}},
  {name: "Компонент со своим состоянием", props: {path: resolve(import.meta.dir, "fixture/component/spec/stateful.test.tsx")}},
  {name: "Компонент с преобразованием входных данных", props: {path: resolve(import.meta.dir, "fixture/component/spec/derived-input.test.tsx")}},
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
  /** @remarks Конкретный пример JSX принадлежит варианту отчёта компонента. */
  describe.skipIf(props.path !== resolve(import.meta.dir, "fixture/component/spec/scenario.spec.tsx"))("Параметры компонента", () => {
    test("Значения в JSX", () => {
      expect(report.preview?.variants[0]?.source,
        "Выбранные значения и callback видны в своих атрибутах компонента; пример раскрывает подготовленные props в месте использования",
      ).toBe(`import {mock} from "bun:test"
import {Command} from "@fixture/scenario-component"

<Command
  label={"Продолжить"}
  disabled={false}
  onActivate={mock<(label: string) => void>()}
/>`)
    })
  })
})
