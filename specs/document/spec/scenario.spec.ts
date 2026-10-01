/**
Документ строится из одного завершённого отчёта, без повторного запуска предмета.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from "@archetypes/scenario-reader"
import createScenarioGuide from "@archetypes/scenario-document"

const report = await readScenario({path: resolve(import.meta.dir, "../../scenarios/reader/spec/fixture/function/spec/scenario.spec.ts")})
describe.each([{name: "Документ сценария", props: {report}}])("$name", async ({props}) => {
  const result = await createScenarioGuide(props)
  test("Исходный пример", () => {
    expect(result.examples[0]?.code, "Показан исходник того же завершённого отчёта").toBe(props.report.source.text)
  })
  test("Проверки", () => {
    expect(result.checks.map(check => check.rule), "Правила взяты из полученного отчёта, а не пересчитаны другим исполнением")
      .toEqual(props.report.validation.checks.map(check => check.rule))
  })
})
