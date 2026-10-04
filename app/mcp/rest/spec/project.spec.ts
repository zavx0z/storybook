import {describe, expect, test} from "bun:test"
import storybookRest from "@zavx0z/storybook-app-mcp-rest"

describe.each([
  {name: "GET", request: new Request("http://localhost")},
  {name: "Пустой POST", request: new Request("http://localhost", {method: "POST"})},
  {name: "POST с пустым объектом", request: new Request("http://localhost", {method: "POST", body: "{}"})},
])("Вход Project: $name", async ({request}) => {
  const response = await storybookRest(request, {
    projectName: "Мастерская",
    entries: [
      {
        path: "shop",
        label: "Магазин",
        description: "Полное описание Repo.",
        summary: "Продажа товаров.\n\nПодробности работы.",
        parent: null,
        sources: {input: {path: "/not-readable/contract.ts", digest: "not-discovered"}},
      },
      {path: "shop/cart", description: "Корзина.", parent: "shop"},
    ],
  })
  const result = await response.json()

  test("Ответ Project", () => {
    expect(response.status, "Корень открывается без чтения контрактов участвующих Repo").toBe(200)
    expect(result, "HTTP передаёт предметный ответ Project с его именем и только первым уровнем Repo")
      .toEqual({
        description: "Выберите Repo текущего Project по описанию. Для перехода передайте path выбранного элемента children в следующий вызов storybook. Выбранный владелец раскрывает input и output как JSON Schema с описаниями. Пустой вызов возвращает к этому входу.",
        label: "Мастерская",
        children: [{description: "Продажа товаров.", path: "shop", label: "Магазин"}],
      })
  })
})
