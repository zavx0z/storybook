import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import conformance from "@storybook-package-build/conformance"

describe.each([
  {name: "Компонент с непосредственным сценарием", props: {path: resolve(import.meta.dir, "fixture/component")}},
])("$name", async ({props}) => {
  const report = await conformance.check(props.path, new AbortController().signal)
  const verification = conformance.verify(report)

  test("Нормативный запуск", () => {
    expect(report.tests.some(item => item.status === "passed"), "Исходный отчёт содержит реально выполненные пункты архетипа Package")
      .toBeTrue()
  })

  test("Решение о полноте", () => {
    expect(verification, "Компонент с public default, TSDoc и непосредственным сценарием проходит нормативную проверку")
      .toEqual({status: "passed", diagnostics: []})
  })
})
