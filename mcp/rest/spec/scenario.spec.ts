import {describe, expect, test} from "bun:test"
import {storybookRest} from ".."

const packages = [
  {node: "storybook", title: "Storybook", parent: null},
  {node: "storybook/archetypes", title: "Archetypes", parent: "storybook"},
  {node: "storybook/archetypes/package", title: "Пакет", parent: "storybook/archetypes"},
  {node: "library.v2", title: "Библиотека", parent: null},
]
const read = (input: unknown) => storybookRest(new Request("http://localhost", {
  method: "POST", body: JSON.stringify(input),
}), {packages})

describe.each([
  {name: "Каталог", input: {}, expected: {packages: [
    {node: "storybook", title: "Storybook"}, {node: "library.v2", title: "Библиотека"},
  ]}},
  {name: "Пакет с вложенным пакетом", input: {node: "storybook/archetypes"}, expected: {
    node: "storybook/archetypes", title: "Archetypes", packages: [{node: "storybook/archetypes/package", title: "Пакет"}],
  }},
  {name: "Пакет без вложенных пакетов", input: {node: "storybook/archetypes/package"}, expected: {
    node: "storybook/archetypes/package", title: "Пакет", packages: [],
  }},
])("$name", ({input, expected}) => {
  test("Показывает только адреса пакетов", async () => {
    const result = await read(input)
    expect(result.status).toBe(200)
    expect(await result.json(), "Структура берётся из переданной пакетной проекции общего каталога").toEqual(expected)
  })
})

test.each([
  {node: "storybook?view=scenarios"}, {node: "storybook?inspector=storybook-scenarios"},
  {node: "storybook#section"}, {node: 1}, {node: "storybook", input: {}},
  {action: "journal"}, {node: "storybook", action: "data"}, {future: true},
])("Лишние параметры отклоняются: %j", async input => {
  expect((await read(input)).status).toBe(400)
})

test.each(["storybook/src", "storybook/archetypes/package/readme", "storybook.archetypes.package", "missing"])("Не пакет: %s", async node => {
  const result = await read({node})
  expect(result.status).toBe(404)
  expect((await result.json()).error).toContain("зарегистрированному пакету")
})

test("GET возвращает тот же каталог; query и некорректный JSON не принимаются", async () => {
  expect(await (await storybookRest(new Request("http://localhost"), {packages})).json()).toEqual(await (await read({})).json())
  expect((await storybookRest(new Request("http://localhost?view=scenarios"), {packages})).status).toBe(400)
  expect((await storybookRest(new Request("http://localhost", {method: "POST", body: "{"}), {packages})).status).toBe(400)
  expect((await storybookRest(new Request("http://localhost", {method: "DELETE"}), {packages})).status).toBe(405)
})
