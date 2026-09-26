/**
Общие правила параметризации для любой спецификации.
props.path задаёт проверяемую директорию или отдельный исходник.
Если внешний путь не передан, каждый вариант использует свой пример.
Все проверки выполняются и при прямом запуске, и при вызове из валидатора.
Исходники читаются без исполнения. Ошибочный входной путь приводит к ошибке.

@packageDocumentation
*/
import {describe, expect, mock, test} from "bun:test"
import {resolve} from "node:path"

const checkParameterizationMock = mock(async (input: {path: string}) => {
  const {checkSpecParameterization} = await import("./fixture")
  return checkSpecParameterization(input.path)
})

describe.each([
  {
    name: "Describe использует each",
    props: {path: resolve(import.meta.dir, "fixture/parameterization/spec")},
    expected: [],
    fail: "Внешние describe задают варианты через each; вложенные describe задают категории",
  },
  {
    name: "Test допускается без each",
    props: {path: resolve(import.meta.dir, "fixture/parameterization/plain-test.ts")},
    expected: [],
    fail: "Обычные test внутри параметризованных describe должны соответствовать стандарту",
  },
  {
    name: "Параметризация сохраняется при условном запуске",
    props: {path: resolve(import.meta.dir, "fixture/parameterization/each.ts")},
    expected: [],
    fail: "Условный запуск внешнего describe сохраняет параметризацию вариантов",
  },
  {
    name: "Псевдонимы describe используют each",
    props: {path: resolve(import.meta.dir, "fixture/parameterization/aliases-each.ts")},
    expected: [],
    fail: "Внешние варианты через псевдоним describe сохраняют параметризацию each",
  },
])("$name", ({props, expected, fail}) => {
  test("Проверяет параметризацию объявлений", async () => {
    const actual = await checkParameterizationMock(props)
    expect(actual, fail).toEqual(expected)
  })
})
