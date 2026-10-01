import {afterAll, expect, test} from "bun:test"
import {mkdtempSync, writeFileSync, rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import validateScenario from "@archetypes/scenario-validation"
import readScenario from "@archetypes/scenario-reader"
import {readScenarioSource} from "../src/read-source"

const root = mkdtempSync(resolve(tmpdir(), "storybook-particular-"))
afterAll(() => rmSync(root, {recursive: true, force: true}))
const common = 'point("Общее", () => { expect(1, "Общее свойство").toBe(1) })'
const particular = `/** @remarks Возможность применяется при enabled. */
suite.skipIf(!props.enabled)("Возможность", () => {
  point("Свойство", () => { expect(1, "Частное свойство").toBe(1) })
})`

test.each([
  {name: "только общее", code: common, valid: true},
  {name: "общее перед частным", code: `${common}\n${particular}`, valid: true},
  {name: "общая вложенная тема", code: `suite("Общая тема", () => { ${common} })\n${particular}`, valid: true},
  {name: "частное без оценки архитектуры", code: particular, valid: true},
  {name: "общее после частного", code: `${particular}\n${common}`, valid: false},
  {name: "условный пункт вместо темы", code: 'point.skipIf(!props.enabled)("Свойство", () => { expect(1).toBe(1) })', valid: false},
  {name: "частная тема на третьем уровне", code: `suite("Тема", () => { ${particular} })`, valid: false},
  {name: "другая условная форма", code: 'suite.if(props.enabled)("Тема", () => { point("Свойство", () => { expect(1).toBe(1) }) })', valid: false},
  {name: "пустая частная группа", code: 'suite.skipIf(!props.enabled)("Тема", () => {})', valid: false},
  {name: "регистрация через if", code: `if (props.enabled) { ${common} }`, valid: false},
  {name: "регистрация через выражение", code: `props.enabled && ${common}`, valid: false},
])("Общее и частное: $name", async ({name, code, valid}) => {
  const path = resolve(root, `${name}.spec.ts`)
  writeFileSync(path, `import {describe as suite, test as point, expect} from "bun:test"
suite.each([{props: {enabled: true}}])("Вариант", ({props}) => {
${code}
})
`)
  const source = await readScenarioSource(path)
  const result = validateScenario(source)
  const check = result.checks.find(check => check.rule === "general-particular")!
  expect(check.status).toBe(valid ? "passed" : "failed")
  expect(result.checks.find(check => check.rule === "meaning")?.status).toBe("not-checked")
  if (!valid) {
    expect(check.issues[0]?.location?.path).toBe(source.path)
    await expect(readScenario.supportsPreview({path})).rejects.toThrow()
  }
}, 30_000)

test("частная тема остаётся в дереве вариантов вместе с причиной пропуска", async () => {
  const report = await readScenario({path: resolve(import.meta.dir, "../spec/fixture/function/spec/scenario.spec.ts")})
  expect(report.exitCode).toBe(0)
  expect(report.validation.checks.find(check => check.rule === "general-particular")?.status).toBe("passed")
  expect(report.groups.filter(group => group.label === "Непустой набор")).toHaveLength(2)
  const points = report.tests.filter(item => item.label === "Первое число")
  expect(points.map(item => item.status)).toEqual(["passed", "skipped"])
  expect(points[1]?.skipReason).toBe("Пустой набор не содержит первого числа.")
}, 30_000)
