import {describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {join} from "node:path"
import discoverStorybookPackages from "@zavx0z/storybook-package-metadata-collect"
import storybookRest from ".."

const projectName = "Fixture Project"
const entries = [
  {path: "shop", label: "Магазин", description: "Проект магазина", parent: null},
  {path: "shop/ui", label: "Интерфейс", description: "Компоненты интерфейса", parent: "shop"},
  {path: "shop/ui/button", label: "Кнопка", description: "Действия пользователя", parent: "shop/ui"},
  {path: "library.v2", label: "Библиотека", description: "Общие функции", parent: null},
]
const read = (input: unknown) => storybookRest(new Request("http://localhost", {
  method: "POST", body: JSON.stringify(input),
}), {projectName, entries})

describe.each([
  {name: "Root без проекта Storybook", input: {}, expected: {
    label: projectName, description: expect.stringContaining("path"), children: [
      {path: "shop", label: "Магазин", description: "Проект магазина"},
      {path: "library.v2", label: "Библиотека", description: "Общие функции"},
    ],
  }},
  {name: "Проект", input: {path: "shop/ui"}, expected: {
    path: "shop/ui", label: "Интерфейс", description: "Компоненты интерфейса",
    children: [{path: "shop/ui/button", label: "Кнопка", description: "Действия пользователя"}],
  }},
  {name: "Компонент", input: {path: "shop/ui/button"}, expected: {
    path: "shop/ui/button", label: "Кнопка", description: "Действия пользователя", children: [],
  }},
])("$name", ({input, expected}) => {
  test("Единая форма и авторское назначение", async () => {
    const response = await read(input)
    expect(response.status).toBe(200)
    expect(await response.json(), "label называет направление, description объясняет его, path используется в следующем вызове").toEqual(expected)
  })
})

test("Переходы копируют path из ответа без другого способа адресации", async () => {
  let document = await (await read({})).json()
  for (const expected of ["shop", "shop/ui", "shop/ui/button"]) {
    const selected = document.children[0]
    document = await (await read({path: selected.path})).json()
    expect(document).toMatchObject({path: expected, label: selected.label, description: selected.description})
  }
  expect(document.children).toEqual([])
})

test.each([
  {path: "shop?view=scenarios"}, {path: "shop?inspector=x"}, {path: "shop#section"},
  {path: 1}, {path: "shop", input: {}}, {action: "journal"},
  {path: "shop", action: "data"}, {future: true}, {node: "shop"},
])("Лишние параметры отклоняются: %j", async input => {
  expect((await read(input)).status).toBe(400)
})

test.each(["shop/src", "shop/ui/button/readme", "shop.ui.button", "missing"])("Адрес вне публичной структуры: %s", async path => {
  const result = await read({path})
  expect(result.status).toBe(404)
  expect((await result.json()).error).toContain("публичной структуре")
})

test("GET и пустой POST выбирают независимый Root; пустой каталог допустим", async () => {
  expect(await (await storybookRest(new Request("http://localhost"), {projectName, entries})).json()).toEqual(await (await read({})).json())
  expect(await (await storybookRest(new Request("http://localhost"), {projectName, entries: []})).json())
    .toEqual({label: projectName, description: expect.any(String), children: []})
  expect((await storybookRest(new Request("http://localhost?view=scenarios"), {projectName, entries})).status).toBe(400)
  expect((await storybookRest(new Request("http://localhost", {method: "POST", body: "{"}), {projectName, entries})).status).toBe(400)
  expect((await storybookRest(new Request("http://localhost", {method: "DELETE"}), {projectName, entries})).status).toBe(405)
})

describe.each([{name: "Функция с контрактом", props: {path: "text/trim"}}])("$name", async ({props}) => {
  const library = join(import.meta.dir, "fixture/library")
  const owner = join(library, "text/trim")
  const input = await Bun.file(join(owner, "contract/input.ts")).text()
  const output = await Bun.file(join(owner, "contract/output.ts")).text()
  const scenario = await Bun.file(join(owner, "spec/scenario.spec.ts")).text()
  const catalog = await discoverStorybookPackages([library])
  const scope = catalog.scopes.find(item => item.kind === "package" && item.scopeRoot === library)
  if (scope?.kind !== "package") throw new Error("Владелец контракта отсутствует в каталоге")
  const directory = scope.directories?.find(item => item.path === owner && item.relativePath === props.path)
  const inputSchema = directory?.contractDocumentation?.documents.find(document => document.direction === "input")?.document.declarations[0]?.schema
  const outputSchema = directory?.contractDocumentation?.documents.find(document => document.direction === "output")?.document.declarations[0]?.schema
  if (inputSchema === undefined || outputSchema === undefined) throw new Error("Каталог не подготовил обе схемы контракта")
  const response = await storybookRest(new Request("http://localhost", {
    method: "POST", body: JSON.stringify(props),
  }), {projectName, entries: [{
    path: props.path,
    description: "Удаляет пробелы по краям текста.",
    parent: "text",
    sources: {
      input: {path: join(owner, "contract/input.ts"), digest: createHash("sha256").update(input).digest("hex"), schema: inputSchema},
      output: {path: join(owner, "contract/output.ts"), digest: createHash("sha256").update(output).digest("hex"), schema: outputSchema},
      scenarios: [join(owner, "spec/scenario.spec.ts")],
    },
  }]})
  const result = await response.json()

  test("Условия использования", () => {
    expect(result, "Адрес раскрывает назначение, JSON Schema контрактов и исполняемый пример владельца").toEqual({
      path: props.path, description: "Удаляет пробелы по краям текста.", children: [], input: inputSchema, output: outputSchema, scenarios: [scenario],
    })
  })
  test("Единое описание условия", () => {
    expect(result.scenarios[0], "То же сообщение expect объясняет сохранение содержимого в коде, MCP и отчёте Bun")
      .toContain('expect(result, "Пробелы по краям удалены, содержимое текста сохранено").toBe(expected)')
  })
})
