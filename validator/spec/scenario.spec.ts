/** Проверяет публичную цепочку validate на существующей фикстуре Archetypes. @packageDocumentation */
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {validate} from ".."

const root = resolve(import.meta.dir, "../..")

describe.each([
  {
    name: "Выбор проверки для фикстуры Archetypes",
    props: {
      path: resolve(root, "archetypes/specs/spec/fixture/parameterization/spec"),
      specification: resolve(root, "archetypes/specs/spec/parameterization.spec.ts"),
      pathVariable: "SPEC_DIRECTORY",
      testNamePattern: "^Describe использует each",
    },
    expected: {total: 4, passed: 1, failed: 0, skipped: 3, errors: 0},
    fail: "Validate должен вернуть преобразованный результат только выбранной проверки",
  },
])("$name", ({props, expected, fail}) => {
  test.each([{runtime: async () => {}}])("Запускает и преобразует", async () => {
    const actual = await validate(props)
    expect(actual, fail).toMatchObject({status: "passed", summary: expected, error: null})
  }, 35_000)
})
