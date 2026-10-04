/** Проверяет отказы общего сценария и границы сравнения имён. */
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from "@storybook-specs-scenarios/reader"

describe.each([
  {name: "Суффикс родителя", props: {name: "number-field", ancestors: ["repo", "field"]}, repeated: ["field"]},
  {name: "Префикс родителя", props: {name: "field-group", ancestors: ["repo", "field"]}, repeated: ["field"]},
  {name: "Дальний предок", props: {name: "normalize-collection-items", ancestors: ["repo", "collection", "model"]}, repeated: ["collection"]},
  {name: "Корень Repo", props: {name: "repo-reader", ancestors: ["repo", "package"]}, repeated: ["repo"]},
  {name: "Несколько предков", props: {name: "normalize-number-value", ancestors: ["repo", "number", "value"]}, repeated: ["number", "value"]},
  {name: "PascalCase", props: {name: "NumberField", ancestors: ["repo", "field"]}, repeated: ["field"]},
  {name: "Составное имя", props: {name: "parse-json-patch", ancestors: ["repo", "json-patch"]}, repeated: ["json-patch"]},
  {name: "Часть слова", props: {name: "transport", ancestors: ["repo", "port"]}, repeated: []},
  {name: "Часть составного предка", props: {name: "patch", ancestors: ["repo", "json-patch"]}, repeated: []},
  {name: "Без повтора", props: {name: "normalize-items", ancestors: ["repo", "collection", "model"]}, repeated: []},
  {name: "Сам Repo", props: {name: "repo", ancestors: []}, repeated: []},
])("$name", ({props, repeated}) => {
  test("Результат вложенного запуска", async () => {
    const report = await readScenario({
      path: resolve(import.meta.dir, "scenario.spec.ts"),
      variant: 0,
      props,
    })
    expect(report.tests.find(point => point.label === "Повторение контекста вложенности")?.status)
      .toBe(repeated.length > 0 ? "failed" : "passed")
    expect(report.exitCode === 0).toBe(repeated.length === 0)
    expect(report.assertions.find(point => point.test === "Повторение контекста вложенности")?.actual)
      .toEqual(repeated)
    expect(report.tests.find(point => point.label === "Смысл имени")?.status).toBe("todo")
    expect(report.validation.checks.filter(check => check.status === "failed").map(check => check.rule))
      .toEqual(repeated.length > 0 ? ["execution"] : [])
  }, 30_000)
})
