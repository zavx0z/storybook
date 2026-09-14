/**
Проверяет подготовку данных для явной спецификации формата на корректных
и повреждённых снимках. Здесь не вызывается сериализатор: входы независимы от него.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {inspectSnapshot} from "../spec/fixture"

test("ссылка на корень и ссылочные ключи с пунктуацией", () => {
  const result = inspectSnapshot({
    "a.b": {"": {value: 1}},
    alias: {$type: "reference", path: ["a.b", ""]},
    self: {$type: "reference", path: []},
  })
  expect(result.references.map(({resolved, targetIsObject}) => ({resolved, targetIsObject}))).toEqual([
    {resolved: true, targetIsObject: true},
    {resolved: true, targetIsObject: true},
  ])
  expect(result.invalidValues).toEqual([])
})

describe.each([
  {name: "Отсутствующий ключ", root: {ref: {$type: "reference", path: ["missing"]}}},
  {name: "Свойство прототипа", root: {ref: {$type: "reference", path: ["toString"]}}},
  {name: "Строка вместо индекса массива", root: [{}, {$type: "reference", path: ["0"]}]},
  {name: "Отрицательный индекс", root: [{}, {$type: "reference", path: [-1]}]},
  {name: "Строка вместо массива пути", root: {ref: {$type: "reference", path: "$"}}},
])("$name", ({root}) => {
  test("ссылка не разрешается", () => {
    expect(inspectSnapshot(root).references[0]?.resolved).toBeFalse()
  })
})

describe.each([
  {name: "Примитив", root: {value: 42, ref: {$type: "reference", path: ["value"]}}},
  {name: "Закодированный примитив", root: {value: {$type: "undefined"}, ref: {$type: "reference", path: ["value"]}}},
  {name: "Ссылка на себя", root: {$type: "reference", path: []}},
  {name: "Метаданные другой ссылки", root: {target: {}, a: {$type: "reference", path: ["target"]}, b: {$type: "reference", path: ["a", "path"]}}},
])("$name", ({root}) => {
  test("цель не является сохранённым объектом данных", () => {
    expect(inspectSnapshot(root).references.at(-1)?.targetIsObject).toBeFalse()
  })
})

test("пользовательский $type не превращается в служебную ссылку", () => {
  const result = inspectSnapshot({
    $type: "object",
    value: {
      $type: "reference",
      path: ["данные пользователя"],
      nested: {value: 1},
      alias: {$type: "reference", path: ["value", "nested"]},
    },
  })
  expect(result.escaped).toHaveLength(1)
  expect(result.references).toHaveLength(1)
  expect(result.references[0]?.targetIsObject).toBeTrue()
})

test("ссылка не переходит в соседний снимок", () => {
  inspectSnapshot({target: {value: 1}})
  expect(inspectSnapshot({ref: {$type: "reference", path: ["target"]}}).references[0]?.resolved).toBeFalse()
})

test("пустые коллекции, null и примитивы остаются допустимыми данными", () => {
  expect(inspectSnapshot([{}, [], null, false, 0, ""]).invalidValues).toEqual([])
})

test("непереносимые значения и прямые циклы обнаруживаются без вызова getter", () => {
  let reads = 0
  const cycle: {self?: unknown} = {}
  cycle.self = cycle
  const root = {
    missing: undefined,
    number: NaN,
    date: new Date(),
    cycle,
    get value() {
      reads++
      return 1
    },
  }
  expect(inspectSnapshot(root).invalidValues).toHaveLength(5)
  expect(reads).toBe(0)
})
