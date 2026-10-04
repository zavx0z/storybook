import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import validate from "@storybook-specs-scenarios-reader/validation"
import readScenario from "@storybook-specs-scenarios/reader"
import {readScenarioSource} from "../src/read-source"

const fixture = resolve(import.meta.dir, "../spec/fixture/component/spec")

describe.each([
  {name: "публичный компонент", file: "scenario.spec.tsx", status: "passed"},
  {name: "публичный компонент с состоянием", file: "stateful.test.tsx", status: "passed"},
  {name: "алиас и вложенный JSX", file: "children.test.tsx", status: "passed"},
  {name: "свойства, полученные из данных", file: "derived-input.test.tsx", status: "passed"},
  {name: "композиция и данные фикстуры", file: "composition.test.tsx", status: "passed"},
  {name: "namespace публичного модуля", file: "namespace.test.tsx", status: "passed"},
  {name: "обёртка из фикстуры", file: "wrapped.test.tsx", status: "failed"},
  {name: "локальное затенение импорта", file: "shadowed.test.tsx", status: "failed"},
  {name: "обёртка в слоте", file: "wrapped-slot.test.tsx", status: "failed"},
])("$name", ({file, status}) => {
  test("проверяет происхождение JSX, а не написание имени", async () => {
    const source = await readScenarioSource(resolve(fixture, file))
    const check = validate(source).checks.find(check => check.rule === "component-origin")
    expect(check?.status).toBe(status)
    if (status === "failed") {
      expect(check?.issues[0]?.message).toContain("скрывает композицию")
      expect(check?.issues[0]?.location?.path).toBe(source.path)
      expect(check?.issues[0]?.location?.line).toBeGreaterThan(1)
    }
  })
})

test("публичные компоненты в slots не принимаются за фикстуры", async () => {
  const source = await readScenarioSource(resolve(fixture, "../../slots/spec/scenario.spec.tsx"))
  expect(validate(source).checks.find(check => check.rule === "component-origin")?.status).toBe("passed")
})

test("обёртка останавливает статический probe до исполнения и сборки preview", async () => {
  const error = await readScenario.supportsPreview({path: resolve(fixture, "wrapped.test.tsx")}).catch(error => error)
  expect(readScenario.isAuthoringError(error)).toBeTrue()
  expect(error.checks).toContainEqual(expect.objectContaining({rule: "component-origin", status: "failed"}))
})


test("preview композиции показывает настоящие компоненты и их props без fixture-обёртки", async () => {
  const path = resolve(fixture, "composition.test.tsx")
  expect(await readScenario.supportsPreview({path})).toBeTrue()
  const result = await readScenario({path})
  expect(result.exitCode).toBe(0)
  expect(result.preview?.kind).toBe("component")
  if (result.preview?.kind !== "component") throw new Error("Нет preview композиции")
  expect(result.preview?.variants[0]?.source).toContain('<SlotPanel label={"Данные фикстуры"}>')
  expect(result.preview?.variants[0]?.source).toContain('<Command label={"Данные фикстуры"} disabled={false}')
  expect(result.preview?.variants[0]?.source).toContain('<Content slot="header" label="Содержимое"')
  expect(result.preview?.module.source).not.toContain("./fixture/props")
}, 30_000)
