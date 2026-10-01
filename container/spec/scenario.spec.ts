/**
Раскрывает публичную границу и непосредственные части простой и вложенной композиции.
Исследуемый код не исполняется; его поведение проверяется отдельным примером.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readContainer from "@archetypes/container"

describe.each([
  {
    name: "Композиция с одной частью",
    props: {path: resolve(import.meta.dir, "fixture/compose/adjust")},
    parts: ["@fixture/compose-increment"],
  },
  {
    name: "Композиция с вложенным контейнером",
    props: {path: resolve(import.meta.dir, "fixture/compose")},
    parts: ["@fixture/compose-adjust", "@fixture/compose-double"],
  },
])("$name", async ({props, parts}) => {
  const result = await readContainer(props)
  test("Публичное целое", () => {
    expect(result.component.entries.map(entry => entry.exports),
      "Потребитель получает одну default-реализацию контейнера; именованные типы не добавляют runtime-экспорты")
      .toEqual([["default"]])
    expect(result.component.additionalCode,
      "Контейнер не раскрывает API своих частей дополнительными кодовыми подпутями").toEqual([])
  })
  test("Непосредственные части", () => {
    expect(result.parts.map(part => part.name).sort(),
      "В составе только непосредственные владельцы: компонент вложенного контейнера остаётся внутри него")
      .toEqual([...parts])
  })
  test("Использование частей", () => {
    expect(result.parts.map(part => part.references.map(reference => ({
      name: reference.owner?.name, names: reference.names, public: reference.public,
    }))),
      "Целое обращается к default через публичный вход каждой собственной части; это свидетельство зависимости, а не исполнения")
      .toEqual(parts.map(name => [{name, names: ["default"], public: true}]))
  })
  test("Собственный пример", () => {
    expect(result.component.scenarios,
      "Сценарий контейнера показывает поведение целого у его владельца")
      .toEqual([resolve(props.path, "spec/scenario.spec.ts")])
  })
})
