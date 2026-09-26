/**
Показывает расположение и код сценария функции и компонента.
Технический отчёт подтверждает примеры, но не становится текстом руководства.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenarioGuide} from "@archetypes/specs/scenarios"

describe.each([
  {
    name: "Функция",
    props: {path: resolve(import.meta.dir, "../../../../app/scenarios/spec/fixture/function/spec/scenario.spec.ts")},
    files: [
      {path: "spec/scenario.spec.ts", role: "scenario"},
      {path: "index.ts", role: "public-entry"},
    ],
  },
  {
    name: "Компонент",
    props: {path: resolve(import.meta.dir, "../../../../app/scenarios/spec/fixture/component/spec/scenario.spec.tsx")},
    files: [
      {path: "spec/scenario.spec.tsx", role: "scenario"},
      {path: "index.tsx", role: "public-entry"},
      {path: "spec/fixture/index.tsx", role: "fixture"},
    ],
  },
])("$name", async ({props, files}) => {
  const guide = await readScenarioGuide(props)

  test("Файлы владельца", () => {
    expect(guide.files, "Роли существующих файлов определяются по пути к сценарию").toEqual(files)
  })

  test("Примеры кода", () => {
    expect(guide.examples[0]?.code, "Цельный исходник показывает импорты и организацию сценария").toContain('from "bun:test"')
    expect(guide.examples.some(example => example.title === "Вариант использования" && example.code.includes("describe.each")),
      "Автор видит исходник внешнего варианта, а не снимок результата функции").toBeTrue()
    expect(guide.examples.some(example => example.code.includes("expect(")),
      "Пункты показывают, как написать проверку и пояснение рядом с данными").toBeTrue()
  })

  test("Граница технического отчёта", () => {
    expect(Object.keys(guide), "Вывод Archetypes содержит файлы, код и правила оформления").toEqual(["kind", "files", "examples", "checks"])
    expect(JSON.stringify(guide), "Снимки actual, полный вывод Bun и JUnit остаются у приложения").not.toContain('"actual"')
  })

  test("Непроверенные правила видны", () => {
    expect(guide.checks.some(check => check.status === "not-checked"),
      "Незавершённая проверка не выдаётся за принятую норму").toBeTrue()
  })
})
