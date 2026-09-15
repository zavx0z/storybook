/**
Проверяет перенос значений независимо от запуска Bun и компиляции сценариев.

@packageDocumentation
*/
import {expect, test} from "bun:test"
import {serialize} from "../src/serialize"
import {restoreSnapshot} from "./fixture/restore-snapshot"

test.each([
  {value: NaN, encoded: "NaN"},
  {value: Infinity, encoded: "Infinity"},
  {value: -Infinity, encoded: "-Infinity"},
  {value: -0, encoded: "-0"},
])("сохраняет число $encoded после JSON-передачи", async ({value, encoded}) => {
  const snapshot = JSON.parse(JSON.stringify(await serialize(value)))
  expect(snapshot).toEqual({$type: "number", value: encoded})
  expect(Object.is(Number(snapshot.value), value)).toBeTrue()
})

test("сохраняет условие RegExp, флаги, позицию и общую ссылку", async () => {
  const pattern = /a+/gim
  pattern.lastIndex = 3
  const snapshot = JSON.parse(JSON.stringify(await serialize([pattern, pattern])))
  expect(snapshot).toEqual([
    {$type: "regexp", source: "a+", flags: "gim", lastIndex: 3},
    {$type: "reference", path: [0]},
  ])
  const restored = new RegExp(snapshot[0].source, snapshot[0].flags)
  restored.lastIndex = snapshot[0].lastIndex
  expect(restored.exec("xxaaaa")).toEqual(pattern.exec("xxaaaa"))
  expect(restored.lastIndex).toBe(pattern.lastIndex)
})

test("RegExp сохраняет дополнительные поля, ссылки и пользовательский $type", async () => {
  const pattern = Object.assign(/x/, {$type: "custom", self: null as unknown, data: {value: 7}})
  pattern.self = pattern
  expect(await serialize(pattern)).toEqual({
    $type: "regexp", source: "x", flags: "", lastIndex: 0,
    properties: {$type: "object", value: {$type: "custom", self: {$type: "reference", path: []}, data: {value: 7}}},
  })
})

test("чтение RegExp не выполняет пользовательские getters", async () => {
  const pattern = /a+/gi
  let reads = 0
  for (const key of ["source", "flags", "global"]) Object.defineProperty(pattern, key, {get() { reads++; throw new Error("Пользовательский getter") }})
  expect(await serialize(pattern)).toEqual({$type: "regexp", source: "a+", flags: "gi", lastIndex: 0})
  expect(reads).toBe(0)
})

test("поля и позиция RegExp фиксируются до последующей мутации", async () => {
  const pattern = Object.assign(/x/g, {custom: "до"})
  const snapshot = serialize(pattern)
  pattern.custom = "после"
  pattern.lastIndex = 4
  expect(await snapshot).toEqual({$type: "regexp", source: "x", flags: "g", lastIndex: 0, properties: {custom: "до"}})
})

test("не вызывает getter при чтении значения", async () => {
  let calls = 0
  await serialize({
    get value() {
      calls++
      return 1
    },
  })
  expect(calls, "Сериализация не должна исполнять getter").toBe(0)
})

test("обозначает циклическую ссылку", async () => {
  const value: {self?: unknown} = {}
  value.self = value
  const snapshot = await serialize(value)
  expect(snapshot, "Цикл ссылается на корень снимка").toEqual({self: {$type: "reference", path: []}})
  const restored = restoreSnapshot(snapshot) as typeof value
  expect(restored.self, "Связь объекта с самим собой").toBe(restored)
})

test("сохраняет общий объект один раз и восстанавливает все его вхождения", async () => {
  const shared = {name: "общий", nested: {value: 42}}
  const snapshot = await serialize({first: shared, second: shared, list: [shared]})
  expect(snapshot).toEqual({
    first: shared,
    second: {$type: "reference", path: ["first"]},
    list: [{$type: "reference", path: ["first"]}],
  })
  const restored = restoreSnapshot(snapshot) as {first: typeof shared, second: typeof shared, list: typeof shared[]}
  expect(restored.first).toEqual(shared)
  expect(restored.second).toBe(restored.first)
  expect(restored.list[0]).toBe(restored.first)
})

test("не объединяет разные объекты с одинаковыми данными", async () => {
  const snapshot = await serialize({first: {value: 1}, second: {value: 1}})
  const restored = restoreSnapshot(snapshot) as {first: object, second: object}
  expect(restored.first).toEqual(restored.second)
  expect(restored.first).not.toBe(restored.second)
})

test("сохраняет ключи с точками, скобками и пустыми именами в ссылках", async () => {
  const shared = {value: "данные"}
  const input = [{"a.b[0]": {"": shared}}, {again: shared}]
  const snapshot = await serialize(input)
  expect(snapshot).toEqual([
    {"a.b[0]": {"": shared}},
    {again: {$type: "reference", path: [0, "a.b[0]", ""]}},
  ])
  expect(restoreSnapshot(snapshot)).toEqual(input)
})

test("сохраняет пользовательские метки без смешивания со служебными", async () => {
  const shared = {$type: "reference", path: ["это", "данные"]}
  const input = {first: shared, second: shared}
  const snapshot = await serialize(input)
  expect(snapshot).toEqual({
    first: {$type: "object", value: shared},
    second: {$type: "reference", path: ["first"]},
  })
  const restored = restoreSnapshot(snapshot) as typeof input
  expect(restored).toEqual(input)
  expect(restored.first).toBe(restored.second)
})

test("ссылки внутри экранированного объекта указывают на его сохранённые данные", async () => {
  const shared = {value: 7}
  const input = {$type: "пользовательский", first: shared, second: shared}
  const snapshot = await serialize(input)
  expect(snapshot).toEqual({
    $type: "object",
    value: {
      $type: "пользовательский",
      first: shared,
      second: {$type: "reference", path: ["value", "first"]},
    },
  })
  expect(restoreSnapshot(snapshot)).toEqual(input)
})

test("сохраняет собственное поле __proto__ как данные", async () => {
  const input = JSON.parse('{"__proto__":{"value":1},"constructor":"данные"}')
  const restored = restoreSnapshot(await serialize(input))
  expect(Object.hasOwn(restored as object, "__proto__")).toBeTrue()
  expect(restored).toEqual(input)
})

test("фиксирует обычные поля до мутации и не переиспользует снимки между вызовами", async () => {
  const value = {state: "до"}
  const before = serialize({first: value, second: value})
  value.state = "после"
  const after = serialize({first: value, second: value})
  expect(restoreSnapshot(await before)).toEqual({first: {state: "до"}, second: {state: "до"}})
  expect(restoreSnapshot(await after)).toEqual({first: {state: "после"}, second: {state: "после"}})
})

test("не подменяет поздний результат Promise ранним состоянием того же объекта", async () => {
  const shared = {state: "до"}
  const delayed = Promise.withResolvers<typeof shared>()
  const snapshot = serialize([shared, Promise.resolve(shared), delayed.promise])
  await Promise.resolve()
  shared.state = "после"
  delayed.resolve(shared)
  expect(restoreSnapshot(await snapshot)).toEqual([
    {state: "до"},
    {$type: "promise", status: "fulfilled", value: {state: "до"}},
    {$type: "promise", status: "fulfilled", value: {state: "после"}},
  ])
})

test("сохраняет причину отклонения Promise", async () => {
  expect(await serialize(Promise.reject(new Error("Ошибка"))), "Причина отклонения должна попасть в снимок").toEqual({
    $type: "promise", status: "rejected", error: {$type: "error", name: "Error", message: "Ошибка"},
  })
})
