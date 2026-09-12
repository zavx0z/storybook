/**
Общие правила параметризации для любой спецификации.
SPEC_DIRECTORY задаёт проверяемую директорию, SPEC_FILE — отдельный исходник.
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

/** Разрешает путь относительно файловых фикстур этой спецификации. */
const fixturePath = (path: string) => resolve(import.meta.dir, "fixture", path)
const inputPath = process.env.SPEC_DIRECTORY ?? process.env.SPEC_FILE

describe.each([
  {
    name: "Describe использует each",
    props: {path: inputPath ?? fixturePath("parameterization/spec")},
    expected: [],
    fail: "Все объявления describe должны использовать each",
  },
  {
    name: "Test допускается без each",
    props: {path: inputPath ?? fixturePath("parameterization/plain-test.ts")},
    expected: [],
    fail: "Обычные test внутри параметризованных describe должны соответствовать стандарту",
  },
  {
    name: "Параметризация сохраняется при условном запуске",
    props: {path: inputPath ?? fixturePath("parameterization/each.ts")},
    expected: [],
    fail: "Условный запуск не отменяет обязательность each у describe",
  },
  {
    name: "Псевдонимы describe используют each",
    props: {path: inputPath ?? fixturePath("parameterization/aliases-each.ts")},
    expected: [],
    fail: "Псевдоним describe не отменяет обязательность each",
  },
])("$name", ({props, expected, fail}) => {
  test("Проверяет параметризацию объявлений", async () => {
    const actual = await checkParameterizationMock(props)
    expect(actual, fail).toEqual(expected)
  })
})
