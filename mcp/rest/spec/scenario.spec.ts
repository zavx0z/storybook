import {describe, expect, test} from "bun:test"
import {storybookRest} from ".."
import {fileURLToPath} from "node:url"
import {readScenarios} from "../scenarios"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const archetypesDescription = "Помогает решить, где разместить сущность, когда выделить пакет или категорию и как оформить ответственность, зависимости, контракты и проверки"

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
  test("Возвращает Archetypes со встроенной валидацией", async () => {
    const response = await storybookRest(new Request("http://localhost/api/control/storybook", {method, ...(body === undefined ? {} : {body})}), root)
    const value = await response.json()
    expect(value).toEqual({
      node: "root",
      description: "Выберите archetypes для правил структуры, чтения и встроенной проверки объектов.",
      children: [
        {node: "archetypes", description: archetypesDescription},
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

describe("Документация из выполненного сценария", async () => {
  const request = (body: object) => storybookRest(new Request("http://localhost", {method: "POST", body: JSON.stringify(body)}), root, readScenarios)
  const result = await (await request({node: "archetypes/specs/scenarios"})).json()

  test("Заголовок и назначение", () => {
    expect(result.title).toBe("Сценарии")
    expect(result.content[0].text).toContain("структурированная исполняемая документация")
    expect(Object.keys(result)).toEqual(["node", "title", "content", "sections"])
  })
  test("Варианты и темы раскрываются разделами", () => {
    expect(result.sections.map((entry: {title: string}) => entry.title)).toEqual(["Сценарий функции", "Сценарий компонента"])
    expect(result.sections[0].sections.map((entry: {title: string}) => entry.title)).toEqual([
      "Назначение и границы", "Пример целиком", "Варианты и темы", "Пункт и его описание",
      "Результат и проверяемые условия", "Подготовка и жизненный цикл", "Фикстуры", "Ошибки, пропуски и незавершённость",
    ])
  })
  test("Примеры используют публичные входы своих пакетов", () => {
    expect(result.sections[0].sections[1].sections[0].content[0].value).toContain('from "@fixture/scenario-function"')
    expect(result.sections[1].sections[1].sections[0].content[0].value).toContain('from "@fixture/scenario-component"')
  })
  test("Пояснение раскрывает предмет вместе с примером", () => {
    const section = result.sections[0].sections[3].sections.find((section: {title: string}) => section.title === "Описание пункта")
    expect(section.content[0].text).toContain("объясняет смысл данных")
    expect(section.content[0].value).toContain('expect(result, "Исходные числа, количество элементов и сумма набора")')
    expect(Object.keys(section)).toEqual(["title", "content"])
  })
  test("Служебные списки нарушений не заменяют примеры руководства", () => {
    const paragraphs: {text?: string, value?: unknown}[] = []
    const visit = (section: {content?: typeof paragraphs, sections?: any[]}) => {
      paragraphs.push(...section.content ?? [])
      for (const child of section.sections ?? []) visit(child)
    }
    visit(result)
    expect(paragraphs.filter(paragraph => Array.isArray(paragraph.value) && paragraph.value.length === 0)).toEqual([])
  })
  test("Неподтверждённые положения обозначены без выдуманных данных", () => {
    expect(result.sections[0].sections[0].sections[0]).toEqual({
      title: "Исполняемая документация",
      content: [{text: expect.any(String)}],
      notes: ["Этот раздел ещё требует подтверждения."],
    })
  })
  test("Диагностика сохраняет исходные условия", async () => {
    const data = await (await request({node: "archetypes/specs/scenarios", action: "data"})).json()
    expect(data.scenarios.source).toBe(`${root}archetypes/specs/scenarios/spec/scenario.spec.ts`)
    expect(data.scenarios.variants[0].categories[0].items[0]).toMatchObject({label: "Исполняемая документация", status: "todo", assertions: [], unexecuted: [{customFailMessage: expect.any(String)}]})
    expect(data.scenarios.variants[0].categories[1].items[0].assertions[0].matcher).toBe("toSatisfy")
  }, 20000)
  test("Выбранная тема совпадает с разделом полного документа", async () => {
    const selected = await (await request({node: "archetypes/specs/scenarios", input: {variant: "Сценарий функции", section: ["Пункт и его описание"]}})).json()
    expect(selected.sections).toHaveLength(1)
    expect(selected.sections[0].sections).toEqual([result.sections[0].sections[3]])
  }, 20000)
})
