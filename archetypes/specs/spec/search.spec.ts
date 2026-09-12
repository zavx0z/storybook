/**
Проверяет непосредственный поиск директории spec.
SPEC_PATH задаёт входной путь; по умолчанию используются файловые фикстуры.
Проверки поиска не запускают другие тесты.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {findSpec} from "@storybook/archetypes/specs"

const fixture = fileURLToPath(new URL("./fixture/", import.meta.url))
const inputPath = process.env.SPEC_PATH

/**
Проверяет поведение findSpec на вариантах входного пути.

*/
describe.each([
  {
    name: "Поиск Spec на непосредственном уровне",
    fail: "Результат должен относиться только к непосредственной директории spec переданного пути",
    props: {path: inputPath ?? resolve(fixture, "without-spec")},
    expected: null,
  },
  {
    name: "Spec является директорией",
    fail: "Результатом поиска может быть только директория spec",
    props: {path: inputPath ?? resolve(fixture, "spec-file")},
    expected: null,
  },
  {
    name: "Поиск Spec по несуществующему пути",
    fail: "Для несуществующего входного пути ожидается null",
    props: {path: inputPath ?? resolve(fixture, "missing-owner")},
    expected: null,
  },
])("$name", ({props, expected, fail}) => {
  test.each([
    {
      runtime: async () => {},
    },
  ])("Находит только непосредственную директорию spec", async () => {
    const actual = await findSpec(props.path)
    expect(actual, fail).toBe(expected)
  })
})
