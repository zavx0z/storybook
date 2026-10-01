/**
Проверяет непосредственный поиск директории spec.
props.path задаёт входной путь; по умолчанию используются файловые фикстуры.
Проверки поиска не запускают другие тесты.

@packageDocumentation
*/
import {describe, expect, mock, test} from "bun:test"
import {resolve} from "node:path"

const findSpecMock = mock(async (input: {path: string}) => {
  const {findSpec} = await import("../src/find-spec")
  return findSpec(input.path)
})

/**
Проверяет поведение findSpec на вариантах входного пути.

*/
describe.each([
  {
    name: "Поиск Spec на непосредственном уровне",
    fail: "Результат должен относиться только к непосредственной директории spec переданного пути",
    props: {path: resolve(import.meta.dir, "fixture/without-spec")},
    expected: null,
  },
  {
    name: "Spec является директорией",
    fail: "Результатом поиска может быть только директория spec",
    props: {path: resolve(import.meta.dir, "fixture/spec-file")},
    expected: null,
  },
  {
    name: "Поиск Spec по несуществующему пути",
    fail: "Для несуществующего входного пути ожидается null",
    props: {path: resolve(import.meta.dir, "fixture/missing-owner")},
    expected: null,
  },
])("$name", ({props, expected, fail}) => {
  test("Находит только непосредственную директорию spec", async () => {
    const actual = await findSpecMock(props)
    expect(actual, fail).toBe(expected)
  })
})
