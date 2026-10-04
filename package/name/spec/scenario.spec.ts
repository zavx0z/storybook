/**
Общие правила имени применяются непосредственно к props.name и props.names.
Сценарий вызывающей сущности передаёт имя родителя и имена вложенных частей.
Источник этих данных не меняет правил именования.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import type {PackageName} from "@package/name"

describe.each([
  {
    name: "Имя и вложенные имена",
    props: {name: "catalog", names: ["reader", "search"]},
  },
])("$name", ({props}: {props: PackageName.Input}) => {
  test("Непустое имя", () => {
    expect(props.name, "Имя содержит хотя бы один непробельный символ")
      .toMatch(/\S/u)
  })

  test("Непустые вложенные имена", () => {
    expect(props.names, "Каждое переданное вложенное имя содержит хотя бы один непробельный символ")
      .toSatisfy(names => names.every(name => /\S/u.test(name)))
  })

  test.todo("Смысл имени", () => {
    throw new Error("Проверка того, что имя выражает собственный смысл сущности, ещё не реализована")
  })

  test.todo("Контекст вложенности", () => {
    throw new Error("Имя уточняет вложенную сущность, не повторяя контекст, уже выраженный вложенностью; проверка props.names относительно props.name ещё не реализована")
  })
})
