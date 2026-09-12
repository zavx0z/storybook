import {describe, expect, test} from "bun:test"
import {storybookRest} from ".."
import {fileURLToPath} from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const archetypesDescription = "Помогает решить, где разместить сущность, когда выделить пакет или категорию и как оформить ответственность, зависимости, контракты и проверки"
const validatorDescription = "Проверяет выбранный пакет, категорию или сущность существующей спецификацией и возвращает структурированный отчёт Bun"

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
