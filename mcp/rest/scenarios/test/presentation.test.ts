import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "@archetypes/specs/scenarios"
import type {ScenariosInput, ScenarioSection} from "../src/types"
import {presentScenarios} from "../src/presentation"
import {readScenarios} from ".."

describe("Документация из сценария", async () => {
  const owner = {kind: "repository" as const, path: resolve(import.meta.dir, "../spec/fixture/repository")}
  const source = resolve(owner.path, "spec/scenario.spec.ts")
  const raw = await readScenario({path: source})
  const input: ScenariosInput = {owner, source, prepared: {revision: "test", result: raw}}
  const document = presentScenarios(input, {format: "document"})

  test("Чужой результат не смешивается с выбранным исходником", () => {
    expect(() => presentScenarios({...input, source: resolve(owner.path, "spec/scenario.spec.tsx")})).toThrow("другому сценарию")
  })
  test("Ревизия не подменяется отсутствующим значением", () => {
    expect(() => presentScenarios({...input, prepared: {revision: "", result: raw}})).toThrow("ревизия")
  })
  test("Документ использует только предметные ключи структуры", () => {
    const visit = (section: ScenarioSection) => {
      expect(Object.keys(section).filter(key => !["title", "content", "sections", "notes"].includes(key))).toEqual([])
      for (const paragraph of section.content ?? []) expect(Object.keys(paragraph).filter(key => !["text", "value"].includes(key))).toEqual([])
      for (const child of section.sections ?? []) visit(child)
    }
    expect(Object.keys(document)).toEqual(["sections"])
    for (const section of document.sections ?? []) visit(section)
  })
  test("Пункты и темы сохраняют общий порядок исходника", () => {
    expect(document.sections?.[0]?.sections?.map(section => section.title)).toEqual(["Значение", "Данные"])
    expect(document.sections?.[0]?.sections?.[1]?.sections?.map(section => section.title)).toEqual(["Состав", "Проверки"])
  })
  test("Редактирование документа не меняет источник", () => {
    const before = JSON.stringify(input)
    const copy = presentScenarios(input, {format: "document"})
    Reflect.set(copy.sections![0]!.sections![0]!.content![0]!, "value", "changed")
    expect(JSON.stringify(input)).toBe(before)
  })
  test("Смена идентификатора запуска не меняет документ", () => {
    expect(presentScenarios({...input, prepared: {revision: "another-run", result: raw}}, {format: "document"})).toEqual(document)
  })
  test("Описание связано со своим значением при нескольких утверждениях", () => {
    expect(document.sections?.[0]?.sections?.[1]?.sections?.[0]?.content).toEqual([
      {text: "Текст выбранного варианта", value: ""},
      {text: "Коллекция выбранного варианта", value: []},
    ])
  })
  test("Незавершённые и неприменимые примеры остаются явно обозначенными", () => {
    const sections = document.sections![0]!.sections![1]!.sections![1]!.sections!
    expect(sections[0]).toEqual({title: "Внешняя служба", content: [{text: "Ответ внешней службы"}], notes: ["Вариант не использует внешнюю службу."]})
    expect(sections[1]).toEqual({title: "Дополнение", content: [{text: "Незавершённое требование"}], notes: ["Этот раздел ещё требует подтверждения."]})
    expect(sections[2]).toEqual({title: "Несоответствие", content: [{text: "Непустой текст результата", value: ""}, {text: "Проверка после прерывания"}], notes: ["Пример показывает ожидаемое несоответствие условию."]})
  })
  test("Ошибка примера не выглядит подтверждённым результатом", () => {
    const result = structuredClone(raw)
    Reflect.set(result.tests[0]!, "status", "failed")
    expect(presentScenarios({...input, prepared: {revision: "test", result}}, {format: "document"}).sections?.[0]?.sections?.[0]?.notes)
      .toEqual(["Пример завершился ошибкой; описанный результат не подтверждён."])
  })
  test("Путь выбора состоит из заголовков самого документа", () => {
    const variant = document.sections![0]!
    const parent = variant.sections![1]!
    const child = parent.sections![1]!
    expect(presentScenarios(input, {format: "document", variant: variant.title, section: [parent.title, child.title]}))
      .toEqual({sections: [{title: variant.title, sections: [{title: parent.title, sections: [child]}]}]})
  })
  test("Неверный выбор не подменяется всем документом", () => {
    expect(() => presentScenarios(input, {format: "document", variant: "Обычный", section: ["Нет темы"]})).toThrow("Тема не найдена")
    expect(() => presentScenarios(input, {format: "document", section: ["Данные"]})).toThrow("сначала укажите вариант")
    expect(() => presentScenarios(input, {format: "document", variant: "Нет варианта"})).toThrow("Вариант не найден")
  })
  test("Конечный раздел выбирается по той же цепочке заголовков", () => {
    expect(presentScenarios(input, {format: "document", variant: "Обычный", section: ["Данные", "Состав"]}))
      .toEqual({sections: [{title: "Обычный", sections: [{title: "Данные", sections: [document.sections![0]!.sections![1]!.sections![0]!]}]}]})
    expect(() => presentScenarios(input, {format: "document", variant: "Обычный", section: ["Данные", "Состав", "Нет подраздела"]})).toThrow("Тема не найдена")
  })
  test("Одноимённые категории не объединяются", () => {
    const result = structuredClone(raw)
    const category = result.groups.find(group => group.label === "Данные")!
    Reflect.set(result, "groups", [...result.groups, {...category, id: 999}])
    const duplicated = {...input, prepared: {revision: "test", result}}
    expect(presentScenarios(duplicated, {format: "document"}).sections![0]!.sections!.filter(section => section.title === "Данные")).toHaveLength(2)
    expect(() => presentScenarios(duplicated, {format: "document", variant: "Обычный", section: ["Данные"]})).toThrow("неоднозначно")
  })
  test("Пустой раздел сохраняет заголовок без пустых списков", () => {
    const result = structuredClone(raw)
    Reflect.set(result, "groups", [{...result.groups[0]!, parameters: null}])
    Reflect.set(result, "tests", [])
    expect(presentScenarios({...input, prepared: {revision: "test", result}}, {format: "document"})).toEqual({sections: [{title: "Обычный"}]})
  })
  test("Пункты без describe остаются корневыми разделами", () => {
    const result = structuredClone(raw)
    Reflect.set(result, "groups", [])
    Reflect.set(result, "tests", [{...result.tests[0]!, groupId: null}])
    expect(presentScenarios({...input, prepared: {revision: "test", result}}, {format: "document"}).sections?.[0]?.title).toBe("Значение")
  })
  test("Отсутствие и ожидание документа различимы", () => {
    expect(presentScenarios({owner, source: null, prepared: null}, {format: "document"})).toEqual({notes: ["Документация сценария отсутствует."]})
    expect(presentScenarios({owner, source, prepared: null}, {format: "document"})).toEqual({notes: ["Документация сценария ещё не подготовлена."]})
  })
  test.each([null, "", [], {}, false, 0, {label: "Поле предметных данных", customFailMessage: "Тоже данные"}].map(value => ({value})))("Предметные значения сохраняются: %j", ({value}) => {
    const result = structuredClone(raw)
    Reflect.set(result.assertions[0]!, "actual", value)
    expect(presentScenarios({...input, prepared: {revision: "test", result}}, {format: "document"}).sections?.[0]?.sections?.[0]?.content?.[0]?.value).toEqual(value)
  })
  test("Диагностический каталог сохраняет условия и исходные описания", () => {
    const data = presentScenarios(input)
    expect(data.validation).toEqual(raw.validation)
    expect(data.variants[0]!.items[0]!.assertions[0]).toMatchObject({matcher: "toBe", expected: [7], actual: 7, customFailMessage: "Значение выбранного варианта"})
    expect(data.variants[0]!.categories[0]!.categories[0]!.items[1]).toMatchObject({status: "todo", unexecuted: [{customFailMessage: "Незавершённое требование"}]})
  })
  test("Нарушения валидации видны в документе без тестовой структуры", () => {
    const result = structuredClone(raw)
    Reflect.set(result.validation, "status", "failed")
    expect(presentScenarios({...input, prepared: {revision: "invalid", result}}, {format: "document"}).notes)
      .toEqual(["В оформлении или выполнении сценария обнаружены нарушения. Подробности доступны в диагностике."])
  })
})

describe.each([
  {name: "Функция", path: "function", title: "Несколько чисел", topic: "Итог", item: "Сумма", value: 5},
  {name: "Компонент", path: "component", title: "Доступная команда", topic: "Использование", item: "Подпись", value: "Продолжить"},
])("Документация: $name", async ({path: fixture, title, topic, item, value}) => {
  const path = resolve(import.meta.dir, "../../../../archetypes/specs/scenarios/spec/fixture", fixture)
  const source = resolve(path, "spec", fixture === "component" ? "scenario.spec.tsx" : "scenario.spec.ts")
  const result = await readScenarios({path, source})
  test("Одна форма раскрывает предметные данные разных сущностей", () => {
    expect(!("status" in result.scenarios) && result.scenarios.sections?.find(section => section.title === title)?.sections?.find(section => section.title === topic)?.sections?.find(section => section.title === item)?.content?.[0]?.value).toEqual(value)
  })
})
