import {describe, expect, test} from "bun:test"
import {storybookRest} from ".."
import {fileURLToPath} from "node:url"
import {resolve} from "node:path"
import {readScenarios} from "../scenarios"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const roots = [{name: "storybook", path: root}, {name: "webxr", path: resolve(root, "../webxr-space")}] as const
const archetypesDescription = "Помогает решить, где разместить сущность, когда выделить пакет или категорию и как оформить ответственность, зависимости, контракты и проверки"

const rest = (
  request: Request,
  scenarios?: Parameters<typeof storybookRest>[2],
  journal?: Parameters<typeof storybookRest>[3],
  options: Parameters<typeof storybookRest>[4] = {},
) => storybookRest(request, root, scenarios, journal, {roots, ...options})

test("диагностика журнала не запускает сценарий и не передаёт содержимое записей", async () => {
  const summary = {entries: [{id: "one", status: "success", resultBytes: 150000}], lastWriteError: null}
  const response = await rest(new Request("http://localhost", {method: "POST", body: '{"action":"journal"}'}),
    async () => { throw new Error("Сценарий не запускается для диагностики") }, () => summary)
  expect(await response.json()).toEqual({node: "root", description: "Состояние доставки записей журнала MCP без содержимого ответов", children: [], requestJournal: summary})
})

describe.each([
  {name: "GET без параметров", method: "GET", body: undefined},
  {name: "POST без параметров", method: "POST", body: "{}"},
])("$name", ({method, body}) => {
  test("Возвращает подключённые канонические корни", async () => {
    const response = await rest(new Request("http://localhost/api/control/storybook", {method, ...(body === undefined ? {} : {body})}))
    const value = await response.json()
    expect(value).toEqual({
      node: "root",
      description: "Выберите подключённый корень и раскрывайте его публичную структуру.",
      children: [
        {node: "storybook", description: "One external declaration-driven Storybook server for independently owned packages."},
        {node: "webxr", description: "Единая WebXR-платформа MetaFor"},
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
    const response = await rest(new Request("http://localhost/api/control/storybook", {method: "POST", body}))
    expect(response.status).toBe(400)
  })
})

test("Archetypes раскрывает текущую структуру с каноническими адресами", async () => {
  const response = await rest(new Request("http://localhost/api/control/storybook", {method: "POST", body: JSON.stringify({node: "storybook/archetypes"})}))
  const value = await response.json()
  expect(value).toEqual({
    node: "storybook/archetypes",
    description: archetypesDescription,
    views: [],
    children: [
      {node: "storybook/archetypes/package", description: "Определяет состав пакета: README, package.json и index"},
      {node: "storybook/archetypes/specs", description: "Зависимости, контракты, сценарии и фикстуры спецификаций"},
      {node: "storybook/archetypes/category", description: "Открывайте этот раздел, чтобы решить, когда объединить равноправные сущности по общему признаку и где разместить такую категорию."},
      {node: "storybook/archetypes/entity", description: "Открывайте этот раздел, чтобы оформить самостоятельную сущность с одним основным экспортом, публичным контрактом, исходным кодом и локальной спецификацией."},
      {node: "storybook/archetypes/notes", description: ""},
      {node: "storybook/archetypes/repository", description: "Открывайте этот раздел, чтобы определить состав верхнего уровня репозитория и непосредственного владельца пакетов, категорий, сущностей и спецификаций."},
    ],
  })
  for (const child of value.children) expect(Object.keys(child).sort()).toEqual(["description", "node"])
})

test.each([
  {name: "неизвестный раздел", node: "missing"},
  {name: "прежний суффикс представления", node: "webxr/nodes/node/diagram/scenarios"},
])("$name сохраняет явную ошибку", async ({node}) => {
  const response = await rest(new Request("http://localhost/api/control/storybook", {method: "POST", body: JSON.stringify({node})}))
  expect({status: response.status, body: await response.json()}).toEqual({
    status: 404,
    body: {status: "unavailable", error: "Раздел пока не доступен"},
  })
})

test("input и URL одинаково выбирают подготовленный вариант Diagram", async () => {
  const prepared = {revision: "applied-diagram", result: null}
  const requests = [{
    node: "webxr/nodes/node/diagram",
    input: {view: "scenarios", variant: "Круг"},
  }, {
    node: "webxr/nodes/node/diagram?view=scenarios&variant=Круг",
  }]
  const results = []
  for (const request of requests) {
    let input: Parameters<NonNullable<Parameters<typeof storybookRest>[2]>>[0] | undefined
    const response = await rest(
      new Request("http://localhost", {method: "POST", body: JSON.stringify(request)}),
      async value => {
        input = value
        return {scenarios: {sections: [{title: "Круг"}]}}
      },
      undefined,
      {readPreparedSpec: async () => prepared},
    )
    results.push({status: response.status, node: (await response.json()).node, path: input?.path, prepared: input?.prepared, selection: input?.selection})
  }
  expect(results).toEqual(requests.map(() => ({
    status: 200,
    node: "webxr/nodes/node/diagram",
    path: resolve(root, "../webxr-space/nodes/node/diagram"),
    prepared,
    selection: {variant: "Круг"},
  })))
})

test("адрес и input не выбирают разные варианты сценария", async () => {
  const response = await rest(
    new Request("http://localhost", {method: "POST", body: JSON.stringify({
      node: "webxr/nodes/node/diagram?view=scenarios&variant=Круг",
      input: {view: "scenarios", variant: "Овал"},
    })}),
    async () => ({scenarios: {}}),
  )
  expect(response.status).toBe(400)
})

describe("Спецификации из структуры", () => {
  test("Вложенный пакет раскрывает свои директории", async () => {
    const response = await rest(new Request("http://localhost", {method: "POST", body: JSON.stringify({node: "storybook/archetypes/specs"})}))
    const result = await response.json()
    expect({children: result.children.map((child: {node: string}) => child.node), views: result.views}, "Публичные разделы и представления пакета Specs").toEqual({
      children: ["storybook/archetypes/specs/contract", "storybook/archetypes/specs/contracts", "storybook/archetypes/specs/deps", "storybook/archetypes/specs/fixtures", "storybook/archetypes/specs/notes", "storybook/archetypes/specs/scenarios"],
      views: ["scenarios", "contract"],
    })
  })

  test("Технические директории не становятся маршрутами", async () => {
    const response = await rest(new Request("http://localhost", {method: "POST", body: JSON.stringify({node: "storybook/archetypes/specs/src"})}))
    expect(response.status, "Граница публичных входов владельца").toBe(404)
  })
})

describe("Документация из выполненного сценария", async () => {
  const request = (body: object) => rest(new Request("http://localhost", {method: "POST", body: JSON.stringify(body)}), readScenarios)
  const result = await (await request({node: "storybook/archetypes/specs/scenarios", input: {view: "scenarios"}})).json()

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
  test("Примеры сохраняют фактические импорты своих сценариев", () => {
    expect(result.sections[0].sections[1].sections[0].content[0].value).toContain('from "@fixture/scenario-function"')
    expect(result.sections[1].sections[1].sections[0].content[0].value).toContain('import {CommandFixture} from "./fixture"')
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
    const data = await (await request({node: "storybook/archetypes/specs/scenarios", action: "data", input: {view: "scenarios"}})).json()
    expect(data.scenarios.source).toBe(`${root}archetypes/specs/scenarios/spec/scenario.spec.ts`)
    expect(data.scenarios.variants[0].categories[0].items[0]).toMatchObject({label: "Исполняемая документация", status: "todo", assertions: [], unexecuted: [{customFailMessage: expect.any(String)}]})
    expect(data.scenarios.variants[0].categories[1].items[0].assertions[0].matcher).toBe("toSatisfy")
  }, 20000)
  test("Выбранная тема совпадает с разделом полного документа", async () => {
    const selected = await (await request({node: "storybook/archetypes/specs/scenarios", input: {view: "scenarios", variant: "Сценарий функции", section: ["Пункт и его описание"]}})).json()
    expect(selected.sections).toHaveLength(1)
    expect(selected.sections[0].sections).toEqual([result.sections[0].sections[3]])
  }, 20000)
})
