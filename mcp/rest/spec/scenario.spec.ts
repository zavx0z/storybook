import {describe, expect, test} from "bun:test"
import {storybookRest} from ".."
import {fileURLToPath} from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))

describe.each([
  {name: "GET без параметров", method: "GET", body: undefined},
  {name: "POST без параметров", method: "POST", body: "{}"},
])("$name", ({method, body}) => {
  test("Возвращает только Archetypes и Валидатор", async () => {
    const response = await storybookRest(new Request("http://localhost/api/control/storybook", {method, ...(body === undefined ? {} : {body})}), root)
    const value = await response.json()
    expect(value).toMatchObject({
      status: "success", node: "root",
      children: [
        {node: "archetypes", description: expect.any(String)},
        {node: "validator", description: expect.any(String)},
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
  expect(value.children.map((child: {node: string}) => child.node)).toEqual([
    "archetypes/repository", "archetypes/package", "archetypes/category", "archetypes/entity", "archetypes/specs",
  ])
  for (const child of value.children) expect(Object.keys(child).sort()).toEqual(["description", "node"])
})
