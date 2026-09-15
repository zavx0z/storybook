import {describe, expect, test} from "bun:test"
import {storybookRest} from ".."
import {fileURLToPath} from "node:url"
import {readScenarios} from "../scenarios"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const archetypesDescription = "Помогает решить, где разместить сущность, когда выделить пакет или категорию и как оформить ответственность, зависимости, контракты и проверки"
const validatorDescription = "Проверяет выбранный пакет, категорию или сущность существующей спецификацией и возвращает структурированный отчёт Bun"

test("диагностика журнала не запускает сценарий и не передаёт содержимое записей", async () => {
  const summary = {entries: [{id: "one", status: "success", resultBytes: 150000}], lastWriteError: null}
  const response = await storybookRest(new Request("http://localhost", {method: "POST", body: '{"action":"journal"}'}), root,
    async () => { throw new Error("Сценарий не запускается для диагностики") }, () => summary)
  expect(await response.json()).toEqual({node: "root", description: "Состояние доставки записей журнала MCP без содержимого ответов", children: [], requestJournal: summary})
})

describe.each([
  {name: "GET без параметров", method: "GET", body: undefined},
  {name: "POST без параметров", method: "POST", body: "{}"},
])("$name", ({method, body}) => {
  test("Возвращает только Archetypes и Валидатор", async () => {
    const response = await storybookRest(new Request("http://localhost/api/control/storybook", {method, ...(body === undefined ? {} : {body})}), root)
    const value = await response.json()
    expect(value).toEqual({
      node: "root",
      description: "Выберите archetypes для решений о структуре и ответственности; validator — для проверки уже оформленной структуры существующей спецификацией.",
      children: [
        {node: "archetypes", description: archetypesDescription},
        {node: "validator", description: validatorDescription},
      ],
    })
  })
})

describe.each([
  {name: "Неверный тип узла", body: '{"node":1}'},
  {name: "Действия пока недоступны", body: '{"action":"validate"}'},
  {name: "Неизвестный параметр", body: '{"unknown":1}'},
  {name: "Неверный JSON", body: '{'},
])("$name", ({body}) => {
  test("Отклоняет запрос без выполнения действий", async () => {
    const response = await storybookRest(new Request("http://localhost/api/control/storybook", {method: "POST", body}), root)
    expect(response.status).toBe(400)
  })
})

test("Archetypes раскрывает существующие экспорты с двумя полями", async () => {
  const response = await storybookRest(new Request("http://localhost/api/control/storybook", {method: "POST", body: JSON.stringify({node: "archetypes"})}), root)
  const value = await response.json()
  expect(value).toEqual({
    node: "archetypes",
    description: archetypesDescription,
    children: [
      {node: "archetypes/repository", description: "Открывайте этот раздел, чтобы определить состав верхнего уровня репозитория и непосредственного владельца пакетов, категорий, сущностей и спецификаций."},
      {node: "archetypes/package", description: "Открывайте этот раздел, чтобы решить, когда выделить самостоятельный пакет и как оформить его identity, публичные exports, состав и зависимости."},
      {node: "archetypes/category", description: "Открывайте этот раздел, чтобы решить, когда объединить равноправные сущности по общему признаку и где разместить такую категорию."},
      {node: "archetypes/entity", description: "Открывайте этот раздел, чтобы оформить самостоятельную сущность с одним основным экспортом, публичным контрактом, исходным кодом и локальной спецификацией."},
      {node: "archetypes/specs", description: "Открывайте этот раздел, чтобы оформить проверяемые зависимости, контракты, сценарии и фикстуры рядом с их непосредственным владельцем."},
    ],
  })
  for (const child of value.children) expect(Object.keys(child).sort()).toEqual(["description", "node"])
})

test("неизвестный раздел сохраняет явную ошибку", async () => {
  const response = await storybookRest(new Request("http://localhost/api/control/storybook", {method: "POST", body: JSON.stringify({node: "missing"})}), root)
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({status: "unavailable", error: "Раздел пока не доступен"})
})

describe("Спецификации из структуры", () => {
  test("Вложенный пакет раскрывает свои публичные входы", async () => {
    const response = await storybookRest(new Request("http://localhost", {method: "POST", body: JSON.stringify({node: "archetypes/specs"})}), root)
    expect((await response.json()).children.map((child: {node: string}) => child.node), "Публичные разделы пакета Specs").toEqual([
      "archetypes/specs/deps", "archetypes/specs/contracts", "archetypes/specs/scenarios", "archetypes/specs/fixtures",
    ])
  })

  test("Технические директории не становятся маршрутами", async () => {
    const response = await storybookRest(new Request("http://localhost", {method: "POST", body: JSON.stringify({node: "archetypes/specs/src"})}), root)
    expect(response.status, "Граница публичных входов владельца").toBe(404)
  })
})

describe("Руководство из выполненного теста", async () => {
  const request = (body: object) => storybookRest(new Request("http://localhost", {method: "POST", body: JSON.stringify(body)}), root, readScenarios)
  const result = await (await request({node: "archetypes/specs/scenarios"})).json()

  test("Варианты", () => {
    expect(result.scenarios.variants.map((entry: {label: string}) => entry.label), "Варианты из параметризации руководства").toEqual(["Сценарий функции", "Сценарий компонента"])
  })
  test("Темы и содержание", () => {
    expect(result.scenarios.variants[0].children.map((entry: {label: string}) => entry.label), "Категории со своим содержимым").toEqual([
      "Назначение и границы", "Пример целиком", "Варианты и темы", "Пункт и его описание",
      "Результат и проверяемые условия", "Подготовка и жизненный цикл", "Фикстуры и внешний запуск", "Ошибки, пропуски и незавершённость",
    ])
    expect(result.scenarios.variants[0].children[1].items[0].assertions[0].actual).toContain("summarizeNumbers(props)")
    expect(result.scenarios.variants[1].children[1].items[0].assertions[0].actual).toContain("<Command")
  })
  test("Единое дерево", () => {
    expect(Object.keys(result), "Ответ без пустой навигации, Markdown и отдельного оглавления").toEqual(["node", "description", "scenarios"])
    expect(Object.keys(result.scenarios), "Дерево без случайной ревизии запуска").toEqual(["status", "variants"])
    expect(Object.keys(result.scenarios.variants[0].children[0])).toEqual(["label", "items"])
  })
  test("Условие сопоставления", () => {
    expect(
      result.scenarios.variants[0].children[1].items[0].assertions[0].expected,
      "Условие из установленного пакета инспектора сохраняет шаблон и флаги RegExp, а не пустой объект",
    ).toEqual([{$type: "regexp", source: "\\S", flags: "u", lastIndex: 0}])
  })
  test("Причина пропуска", () => {
    const item = result.scenarios.variants[0].children[3].items.find((item: {label: string}) => item.label === "Связанные утверждения")
    expect(item.status, "Применимый пункт действительно выполнен").toBe("passed")
    expect(item.skipReason, "У выполненного пункта нет ложной причины пропуска").toBeUndefined()
  })
  test("Смысловые требования", () => {
    expect(result.scenarios.variants[0].children[0].items[0], "Незавершённая оценка остаётся при описываемом пункте").toMatchObject({
      label: "Исполняемая документация", status: "todo", unexecuted: [{customFailMessage: expect.any(String)}],
    })
    expect(result.scenarios.variants[0].children[0].items[0].assertions).toBeUndefined()
  })
  test("Полные данные отдельно", async () => {
    const data = await (await request({node: "archetypes/specs/scenarios", action: "data"})).json()
    expect(data.scenarios.source, "Тот же тест-руководство остаётся источником данных").toBe(`${root}archetypes/specs/scenarios/spec/scenario.spec.ts`)
    expect(data.scenarios.variants[0].categories[0].items[0]).toMatchObject({label: "Исполняемая документация", status: "todo", assertions: [], unexecuted: [{customFailMessage: expect.any(String)}]})
  }, 20000)
  test("Одна тема без потери её содержания", async () => {
    const selected = await (await request({node: "archetypes/specs/scenarios", input: {variant: "Сценарий функции", section: ["Пункт и его описание"]}})).json()
    expect(selected.scenarios.variants).toHaveLength(1)
    expect(selected.scenarios.variants[0].children).toHaveLength(1)
    expect(selected.scenarios.variants[0].children[0]).toEqual(result.scenarios.variants[0].children[3])
  }, 20000)
})
