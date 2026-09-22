import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "@archetypes/specs/scenarios"

describe("Передача параметров запуска", async () => {
  const path = resolve(import.meta.dir, "fixture/run-props.test.ts")
  const source = await Bun.file(path).text()
  const props = {path: "путь с пробелами", settings: {enabled: false, items: [0, "", null]}, text: "я".repeat(100_000)}
  const result = await readScenario({path, props})
  const defaults = await readScenario({path})

  test("Именованные поля", () => {
    expect(result.assertions.filter(item => item.test === "Параметры").map(item => item.actual)).toEqual([
      {...props, keep: 1},
      {...props, keep: 2},
    ])
  })
  test("Контекст вариантов", () => {
    expect(result.groups.filter(group => group.parentId === null).map(group => group.parameters)).toEqual([
      {name: "Первый", props: {...props, keep: 1}},
      {name: "Второй", props: {...props, keep: 2}},
    ])
  })
  test("Граница подстановки", () => {
    expect(result.assertions.filter(item => item.test === "Вложенные параметры" || item.test === "Параметры пункта")
      .map(item => item.actual)).toEqual(["nested", "test", "nested", "test"])
  })
  test("Штатное выполнение", () => {
    expect(result.exitCode).toBe(0)
  })
  test("Следующий запуск без подстановки", () => {
    expect(defaults.assertions.filter(item => item.test === "Параметры").map(item => item.actual)).toEqual([
      {path: "first", keep: 1, settings: {original: true}, text: ""},
      {path: "second", keep: 2, settings: {original: true}, text: ""},
    ])
  })
  test("Исходный файл", async () => {
    expect(await Bun.file(path).text()).toBe(source)
  })
  test("Фильтр имён", async () => {
    const filtered = await readScenario({path, props: {path: "filtered"}, testNamePattern: "Второй Параметры$"})
    expect(filtered.assertions.filter(item => item.test !== null).map(item => ({test: item.test, actual: item.actual}))).toEqual([
      {test: "Параметры", actual: {path: "filtered", keep: 2, settings: {original: true}, text: ""}},
    ])
  })
})

test("Путь передаётся непосредственно сценарию пакета", async () => {
  const result = await readScenario({
    path: resolve(import.meta.dir, "../../../package/spec/scenario.spec.ts"),
    props: {path: resolve(import.meta.dir, "../..")},
  })
  expect(result.calls.filter(call => call.name === "readPackage").map(call => call.args)).toEqual([
    [{path: resolve(import.meta.dir, "../..")}],
    [{path: resolve(import.meta.dir, "../..")}],
  ])
})

test.each([undefined, NaN, Infinity, -0, () => 1, new Date(), {toJSON: () => "lost"}])("Непереносимый параметр %p", async value => {
  await expect(readScenario({path: resolve(import.meta.dir, "fixture/run-props.test.ts"), props: {value}})).rejects.toThrow(TypeError)
})

test("Исходник вызова показывает подставленное значение", async () => {
  const result = await readScenario({
    path: resolve(import.meta.dir, "fixture/function-preview/spec/scenario.spec.ts"),
    props: {value: "Внешнее значение"},
  })
  const variant = result.preview?.variants.find(item => item.title === "Импортированная функция")
  expect(variant?.source).toBe('import {evaluate as run} from "@fixture/function-preview"\n\nawait run({\n  "value": "Внешнее значение"\n})\n\nawait run({\n  "value": null\n})')
})

test("Выбранный вариант выполняется без подготовки соседних вариантов", async () => {
  const result = await readScenario({
    path: resolve(import.meta.dir, "fixture/run-props.test.ts"),
    variant: 1,
    props: {path: "selected"},
  })
  expect(result.groups.filter(group => group.parentId === null).map(group => group.label)).toEqual(["Второй"])
  expect(result.assertions.filter(item => item.test === "Параметры").map(item => item.actual)).toEqual([
    {path: "selected", keep: 2, settings: {original: true}, text: ""},
  ])
})

test("Выбранный импортированный аргумент сохраняет исходный импорт", async () => {
  const result = await readScenario({
    path: resolve(import.meta.dir, "fixture/function-preview/spec/scenario.spec.ts"),
    variant: 7,
    props: {},
  })
  expect(result.preview?.variants.map(item => item.title)).toEqual(["Импортированная функция"])
  expect(result.preview?.variants[0]?.source).toContain('"value": sampleValue')
})

test("Отменённый запуск не выполняет тест", async () => {
  const controller = new AbortController()
  controller.abort(new Error("Отменено"))
  await expect(readScenario({
    path: resolve(import.meta.dir, "fixture/run-props.test.ts"),
    variant: 0,
    signal: controller.signal,
  })).rejects.toThrow("Отменено")
})

test("Цикл и вычисляемое поле отклоняются без исполнения getter", async () => {
  let reads = 0
  const props = {
    get value() {
      reads++
      return 1
    },
  }
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const path = resolve(import.meta.dir, "fixture/run-props.test.ts")
  await expect(readScenario({path, props})).rejects.toThrow(TypeError)
  await expect(readScenario({path, props: cyclic})).rejects.toThrow(TypeError)
  expect(reads).toBe(0)
})
