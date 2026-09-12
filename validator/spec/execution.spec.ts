/**
Проверяет ошибки запуска и отсутствие выбранных тестов на существующих исходниках Archetypes.
@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {validate} from ".."

const root = resolve(import.meta.dir, "../..")
const path = resolve(root, "archetypes/specs/spec/fixture/parameterization/spec")
const specification = resolve(root, "archetypes/specs/spec/parameterization.spec.ts")

describe.each([
  {
    name: "Фильтр не выбрал проверок",
    props: {path, specification, pathVariable: "SPEC_DIRECTORY", testNamePattern: "^UNMATCHED_VALIDATOR_CASE$"},
    expected: "error",
    fail: "Отсутствие выполненных тестов не должно обозначаться как успешная проверка",
  },
  {
    name: "Источник тестов отсутствует",
    props: {path, specification: resolve(root, "validator/missing.spec.ts"), pathVariable: "SPEC_DIRECTORY"},
    expected: "error",
    fail: "Отсутствующий источник тестов должен давать ошибку запуска",
  },
  {
    name: "Запуск ограничен по времени",
    props: {path, specification, pathVariable: "SPEC_DIRECTORY", timeoutMs: 1},
    expected: "error",
    fail: "Прерванная проверка не должна возвращать успешный статус",
  },
])("$name", ({props, expected, fail}) => {
  test.each([{runtime: async () => {}}])("Возвращает состояние выполнения", async () => {
    const actual = await validate(props)
    expect(actual.status, fail).toBe(expected)
  }, 35_000)
})
