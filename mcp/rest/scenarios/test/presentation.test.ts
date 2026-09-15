import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "@archetypes/specs/scenarios"
import type {ScenariosInput} from "../src/types"
import {presentScenarios} from "../src/presentation"

describe("Границы представления", async () => {
  const owner = {kind: "repository" as const, path: resolve(import.meta.dir, "../spec/fixture/repository")}
  const source = resolve(owner.path, "spec/scenario.spec.ts")
  const raw = await readScenario({path: source})
  const input: ScenariosInput = {owner, source, prepared: {revision: "test", result: raw}}

  test("Чужой результат не смешивается с выбранным исходником", () => {
    expect(() => presentScenarios({...input, source: resolve(owner.path, "spec/scenario.spec.tsx")})).toThrow("другому сценарию")
  })
  test("Ревизия не подменяется отсутствующим значением", () => {
    expect(() => presentScenarios({...input, prepared: {revision: "", result: raw}})).toThrow("ревизия")
  })
  test("Редактирование ответа не меняет полный результат валидации", () => {
    const before = JSON.stringify(raw)
    const result = presentScenarios(input)
    Reflect.set(result.variants[0]!.items[0]!.assertions[0]!, "actual", "changed")
    expect(JSON.stringify(raw)).toBe(before)
  })
  test("У незавершённого пункта остаётся описание, но нет выдуманных actual", () => {
    const result = presentScenarios(input)
    const item = result.variants[0]!.categories[0]!.categories[0]!.items[1]!
    expect({status: item.status, reached: item.assertions, planned: item.unexecuted.map(item => item.customFailMessage)})
      .toEqual({status: "todo", reached: [], planned: ["Незавершённое требование"]})
  })
  test("Структура и содержание не дублируются", () => {
    const tree = presentScenarios(input, {format: "tree"})
    expect(Object.keys(tree)).toEqual(["status", "variants"])
    expect(Object.keys(tree.variants![0]!)).toEqual(["label", "parameters", "children", "items"])
    expect(Object.keys(tree.variants![0]!.children![0]!.children![0]!)).toEqual(["label", "items"])
    expect(Object.keys(tree.variants![0]!.items![0]!.assertions![0]!)).toEqual(["customFailMessage", "actual", "matcher", "expected", "status"])
    expect(presentScenarios({...input, prepared: {revision: "another-run", result: raw}}, {format: "tree"})).toEqual(tree)
  })
  test("Редактирование дерева не меняет источник", () => {
    const before = JSON.stringify(input)
    const tree = presentScenarios(input, {format: "tree"})
    Reflect.set(tree.variants![0]!.items![0]!.assertions![0]!, "actual", "changed")
    expect(JSON.stringify(input)).toBe(before)
  })
  test("Незавершённость и ожидаемый провал не маскируются успешным тестом", () => {
    const items = presentScenarios(input, {format: "tree"}).variants![0]!.children![0]!.children![0]!.items!
    expect(items[0]).toMatchObject({status: "skipped", skipReason: "Вариант не использует внешнюю службу."})
    expect(items[1]).toEqual({label: "Дополнение", status: "todo", unexecuted: [{customFailMessage: "Незавершённое требование"}]})
    expect(items[2]).toMatchObject({status: "passed", assertions: [{status: "failed", actual: "", expected: [""], modifiers: ["not"], error: expect.any(Object)}], unexecuted: [{customFailMessage: "Проверка после прерывания"}]})
  })
  test("Путь выбора читается из самого дерева", () => {
    const tree = presentScenarios(input, {format: "tree"})
    const variant = tree.variants![0]!
    const parent = variant.children![0]!
    const child = parent.children![0]!
    const selected = presentScenarios(input, {format: "tree", variant: variant.label, section: [parent.label, child.label]})
    expect(selected).toEqual({status: "ready", variants: [{label: variant.label, parameters: {name: "Обычный", props: {value: 7}}, children: [{label: parent.label, children: [child]}]}]})
  })
  test("Неверный выбор не подменяется всем деревом", () => {
    expect(() => presentScenarios(input, {format: "tree", variant: "Обычный", section: ["Нет темы"]})).toThrow("Тема не найдена")
    expect(() => presentScenarios(input, {format: "tree", section: ["Данные"]})).toThrow("сначала укажите вариант")
    expect(() => presentScenarios(input, {format: "tree", variant: "Нет варианта"})).toThrow("Вариант не найден")
  })
  test("Одноимённые категории не объединяются", () => {
    const result = structuredClone(raw)
    const category = result.groups.find(group => group.label === "Данные")!
    Reflect.set(result, "groups", [...result.groups, {...category, id: 999}])
    const duplicated = {...input, prepared: {revision: "test", result}}
    expect(presentScenarios(duplicated, {format: "tree"}).variants![0]!.children).toHaveLength(2)
    expect(() => presentScenarios(duplicated, {format: "tree", variant: "Обычный", section: ["Данные"]})).toThrow("неоднозначно")
  })
  test("Пустая категория остаётся без пустых children и items", () => {
    const result = structuredClone(raw)
    Reflect.set(result, "groups", [{...result.groups[0]!, parameters: null}])
    Reflect.set(result, "tests", [])
    expect(presentScenarios({...input, prepared: {revision: "test", result}}, {format: "tree"})).toEqual({status: "ready", variants: [{label: "Обычный"}]})
  })
  test("Пункты без describe остаются на корневом уровне", () => {
    const result = structuredClone(raw)
    Reflect.set(result, "groups", [])
    Reflect.set(result, "tests", [{...result.tests[0]!, groupId: null}])
    const tree = presentScenarios({...input, prepared: {revision: "test", result}}, {format: "tree"})
    expect(Object.keys(tree)).toEqual(["status", "items"])
    expect(tree.items![0]!.label).toBe("Значение")
  })
  test("Отсутствие и ожидание результата различаются без пустых деревьев", () => {
    expect(presentScenarios({owner, source: null, prepared: null}, {format: "tree"})).toEqual({status: "absent"})
    expect(presentScenarios({owner, source, prepared: null}, {format: "tree"})).toEqual({status: "pending"})
  })
  test.each([null, "", [], {}, false, 0, "строка с Markdown"].map(value => ({value})))("Фактическое значение: %j", ({value}) => {
    const result = structuredClone(raw)
    Reflect.set(result.assertions[0]!, "actual", value)
    const tree = presentScenarios({...input, prepared: {revision: "test", result}}, {format: "tree"})
    expect(tree.variants![0]!.items![0]!.assertions![0]!.actual).toEqual(value)
  })
})
