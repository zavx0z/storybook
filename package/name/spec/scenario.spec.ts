/**
Проверяет собственное имя относительно имён предков до уровня Repo.
Слова выделяются по разделителям и границам регистра; имя предка сравнивается
как целая последовательность слов. Формы единственного и множественного числа
не приравниваются. Смысловая оправданность имени остаётся отдельной проверкой.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import type {PackageName} from "@package/name"

describe.each([
  {name: "Имя внутри репозитория", props: {name: "normalize-items", ancestors: ["immersive", "collection", "model"]}},
  {name: "Имя репозитория", props: {name: "immersive", ancestors: []}},
  {name: "Совпадение части слова", props: {name: "transport", ancestors: ["repo", "port"]}},
])("$name", ({props}: {props: PackageName.Input}) => {
  const [words = [], ...ancestors] = [props.name, ...props.ancestors].map(name => name
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [])
  const repeated = props.ancestors.filter((_, index) => {
    const ancestor = ancestors[index]!
    return ancestor.length > 0 && words.some((_, start) =>
      ancestor.every((word, offset) => words[start + offset] === word))
  })

  test("Непустое имя", () => {
    expect(props.name, "Имя содержит хотя бы один непробельный символ").toMatch(/\S/u)
  })

  test("Имена предков", () => {
    expect(props.ancestors, "Каждое имя предка непусто; у самого Repo список предков пуст")
      .toSatisfy(values => values.every(name => /\S/u.test(name)))
  })

  test("Повторение контекста вложенности", () => {
    expect(repeated,
      `Имя «${props.name}» не повторяет целые имена предков из ${JSON.stringify(props.ancestors)}; совпадение части слова повторением не считается`)
      .toEqual([])
  })

  test.todo("Смысл имени", () => {
    throw new Error("Проверка того, что имя выражает собственный смысл сущности, ещё не реализована")
  })
})
