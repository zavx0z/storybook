/**
 Проверяет пояснения пропусков в TSDoc.
 SPEC_DIRECTORY выбирает проверяемую директорию; по умолчанию проверяется эта spec.
 @packageDocumentation
 */
import {describe, expect, mock, test} from "bun:test"
import {resolve} from "node:path"
import {fileURLToPath} from "node:url"

const checkSkipRemarksMock = mock(async (input: {path: string}) => {
  const {checkSkipRemarks} = await import("./fixture/skip-remarks.ts")
  return checkSkipRemarks(input.path)
})

const findUndocumentedSkipsMock = mock(async (input: {path: string}) => {
  const {findUndocumentedSkips} = await import("./fixture/skip-remarks.ts")
  return findUndocumentedSkips(input.path)
})

const fixture = fileURLToPath(new URL("./fixture/skip-remarks/", import.meta.url))

describe.each([
  {
    name: "Каждый пропуск объяснён в remarks",
    props: {path: process.env.SPEC_DIRECTORY ?? fileURLToPath(new URL("./", import.meta.url))},
    expected: [],
    fail: "Перед каждым пропуском должен быть TSDoc с непустым @remarks",
  },
])("$name", ({props, expected, fail}) => {
  test("Проверяет пояснения пропусков", async () => {
    const actual = await checkSkipRemarksMock(props)
    expect(actual, fail).toEqual(expected)
  }, 35_000)
})

describe.each([
  {
    name: "Пояснённые пропуски",
    props: {path: resolve(fixture, "documented.ts")},
    expected: [],
    fail: "Непустые remarks должны приниматься"
  },
  {
    name: "Отсутствующие заметки",
    props: {path: resolve(fixture, "missing.ts")},
    expected: ["describe.skipIf", "test.skip"],
    fail: "Псевдонимы и обычные комментарии не отменяют требование remarks"
  },
  {
    name: "Пустая заметка",
    props: {path: resolve(fixture, "empty.ts")},
    expected: ["test.skip"],
    fail: "Пустой remarks не объясняет пропуск"
  },
])("$name", ({props, expected, fail}) => {
  test("Распознаёт наличие пояснения", async () => {
    const actual = await findUndocumentedSkipsMock(props)
    expect(actual, fail).toEqual(expected)
  }, 35_000)
})
