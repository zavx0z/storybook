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
      status: "success", node: "root", actions: [],
      children: [
        {id: "archetypes", packageName: "@storybook/archetypes"},
        {id: "validator", packageName: "@storybook/validator"},
      ],
    })
  })
})

describe.each([
  {name: "Раскрытие узла пока недоступно", body: '{"node":"archetypes"}'},
  {name: "Действия пока недоступны", body: '{"action":"validate"}'},
  {name: "Неизвестный параметр", body: '{"unknown":1}'},
  {name: "Неверный JSON", body: '{'},
])("$name", ({body}) => {
  test("Отклоняет запрос без выполнения действий", async () => {
    const response = await storybookRest(new Request("http://localhost/api/control/storybook", {method: "POST", body}), root)
    expect(response.status).toBe(400)
  })
})
